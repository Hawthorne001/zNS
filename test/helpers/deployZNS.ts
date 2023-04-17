import {
  ZeroTokenMock,
  ZeroTokenMock__factory,
  ZNSAddressResolver,
  ZNSAddressResolver__factory,
  ZNSDomainToken,
  ZNSDomainToken__factory,
  ZNSEthRegistrar,
  ZNSEthRegistrar__factory,
  ZNSPriceOracle,
  ZNSPriceOracle__factory,
  ZNSRegistry,
  ZNSRegistry__factory,
  ZNSTreasury,
  ZNSTreasury__factory,
} from "../../typechain";
import { ethers } from "hardhat"
import { PriceOracleConfig, RegistrarConfig, ZNSContracts } from "./types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

export const deployRegistry = async (
  deployer: SignerWithAddress
): Promise<ZNSRegistry> => {
  const registryFactory = new ZNSRegistry__factory(deployer);
  const registry = await registryFactory.deploy();

  // To set the owner of the zero domain to the deployer
  await registry.connect(deployer).initialize(deployer.address);

  return registry;
};

export const deployAddressResolver = async (
  deployer: SignerWithAddress,
  registryAddress: string
): Promise<ZNSAddressResolver> => {
  const addressResolverFactory = new ZNSAddressResolver__factory(deployer);
  const addressResolver = await addressResolverFactory.deploy(registryAddress);

  return addressResolver;
}

export const deployPriceOracle = async (
  deployer: SignerWithAddress,
  config: PriceOracleConfig
): Promise<ZNSPriceOracle> => {
  const priceOracleFactory = new ZNSPriceOracle__factory(deployer);
  const priceOracle = await priceOracleFactory.deploy();

  // The Registrar may not be deployed yet because of the cyclic dependency
  // between it and the ZNSPriceOracle. Use an empty string if so
  const registrarAddress = !config.registrarAddress ? "" : config.registrarAddress;

  await priceOracle.initialize(
    config.rootDomainPrice,
    config.subdomainPrice,
    config.priceMultiplier,
    config.rootDomainBaseLength,
    config.subdomainBaseLength,
    registrarAddress
  )

  return priceOracle;
}

export const deployDomainToken = async (
  deployer: SignerWithAddress
): Promise<ZNSDomainToken> => {
  const domainTokenFactory = new ZNSDomainToken__factory(deployer);
  return domainTokenFactory.deploy();
};

export const deployZTokenMock = async (
  deployer: SignerWithAddress
): Promise<ZeroTokenMock> => {
  const zTokenMockFactory = new ZeroTokenMock__factory(deployer);
  return zTokenMockFactory.deploy(deployer.address);
};

export const deployTreasury = async (
  deployer: SignerWithAddress,
  zTokenMockAddress: string
): Promise<ZNSTreasury> => {
  const treasuryFactory = new ZNSTreasury__factory(deployer);
  // TODO:  fix this when Oracle is ready
  return treasuryFactory.deploy(deployer.address, zTokenMockAddress);
};

export const deployRegistrar = async (
  deployer: SignerWithAddress,
  config: RegistrarConfig
): Promise<ZNSEthRegistrar> => {
  const registrarFactory = new ZNSEthRegistrar__factory(deployer);
  const registrar = await registrarFactory.deploy(
    config.treasury.address,
    config.registryAddress,
    config.domainTokenAddress,
    config.addressResolverAddress,
    config.priceOracleAddress
  );

  await config.treasury.connect(deployer).setZnsRegistrar(registrar.address);

  return registrar;
};

export const deployZNS = async (deployer: SignerWithAddress): Promise<ZNSContracts> => {
  const registry = await deployRegistry(deployer);

  const domainToken = await deployDomainToken(deployer);

  const zTokenMock = await deployZTokenMock(deployer);

  const addressResolver = await deployAddressResolver(deployer, registry.address);

  const treasury = await deployTreasury(deployer, zTokenMock.address);

  // TODO parameterize these values
  // Set "registrarAddress" after the registrar is deployed
  const oracleConfig: PriceOracleConfig = {
    rootDomainPrice: ethers.utils.parseEther("1"),
    subdomainPrice: ethers.utils.parseEther("0.2"),
    priceMultiplier: ethers.BigNumber.from("390"),
    rootDomainBaseLength: 3,
    subdomainBaseLength: 3,
    registrarAddress: ethers.constants.AddressZero
  }

  const priceOracle = await deployPriceOracle(deployer, oracleConfig);

  const config: RegistrarConfig = {
    treasury: treasury,
    registryAddress: registry.address,
    domainTokenAddress: domainToken.address,
    addressResolverAddress: addressResolver.address,
    priceOracleAddress: priceOracle.address
  }
  const registrar = await deployRegistrar(deployer, config);

  const znsContracts: ZNSContracts = {
    registry: registry,
    domainToken: domainToken,
    zToken: zTokenMock,
    treasury: treasury,
    priceOracle: priceOracle,
    registrar: registrar,
  }

  await priceOracle.connect(deployer).setZNSRegistrar(registrar.address);

  return znsContracts;
};
