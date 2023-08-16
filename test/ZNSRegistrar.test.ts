import * as hre from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  AccessType,
  deployZNS,
  distrConfigEmpty,
  hashDomainLabel,
  INVALID_TOKENID_ERC_ERR,
  normalizeName,
  NOT_AUTHORIZED_REG_ERR,
  NOT_BOTH_OWNER_RAR_ERR,
  NOT_TOKEN_OWNER_RAR_ERR,
  ONLY_NAME_OWNER_REG_ERR,
  ONLY_OWNER_REGISTRAR_REG_ERR, OwnerOf, REGISTRAR_ROLE,
  validateUpgrade,
} from "./helpers";
import { ZNSContracts } from "./helpers/types";
import * as ethers from "ethers";
import { BigNumber } from "ethers";
import { defaultRootRegistration } from "./helpers/register-setup";
import { checkBalance } from "./helpers/balances";
import { priceConfigDefault } from "./helpers/constants";
import { calcAsymptoticPrice, getPriceObject } from "./helpers/pricing";
import { getDomainHashFromReceipt, getDomainRegisteredEvents, getTokenIdFromReceipt } from "./helpers/events";
import { getAccessRevertMsg } from "./helpers/errors";
import { ADMIN_ROLE, GOVERNOR_ROLE } from "./helpers/access";
import { ZNSRegistrar__factory, ZNSRegistrarUpgradeMock__factory } from "../typechain";

require("@nomicfoundation/hardhat-chai-matchers");


describe("ZNSRegistrar", () => {
  let deployer : SignerWithAddress;
  let user : SignerWithAddress;
  let governor : SignerWithAddress;
  let admin : SignerWithAddress;
  let randomUser : SignerWithAddress;

  let zns : ZNSContracts;
  let zeroVault : SignerWithAddress;
  let operator : SignerWithAddress;
  const defaultDomain = normalizeName("wilder");

  beforeEach(async () => {
    [deployer, zeroVault, user, operator, governor, admin, randomUser] = await hre.ethers.getSigners();
    // zeroVault address is used to hold the fee charged to the user when registering
    zns = await deployZNS({
      deployer,
      governorAddresses: [deployer.address, governor.address],
      adminAddresses: [admin.address],
      priceConfig: priceConfigDefault,
      zeroVaultAddress: zeroVault.address,
    });

    // Give funds to user
    await zns.zeroToken.connect(user).approve(zns.treasury.address, ethers.constants.MaxUint256);
    await zns.zeroToken.mint(user.address, priceConfigDefault.maxPrice);
  });

  it("Confirms a user has funds and allowance for the Registrar", async () => {
    const balance = await zns.zeroToken.balanceOf(user.address);
    expect(balance).to.eq(priceConfigDefault.maxPrice);

    const allowance = await zns.zeroToken.allowance(user.address, zns.treasury.address);
    expect(allowance).to.eq(ethers.constants.MaxUint256);
  });

  it("Should revert when initialize() without ADMIN_ROLE", async () => {
    const userHasAdmin = await zns.accessController.hasRole(ADMIN_ROLE, user.address);
    expect(userHasAdmin).to.be.false;

    const registrarFactory = new ZNSRegistrar__factory(deployer);
    const registrar = await registrarFactory.connect(user).deploy();
    await registrar.deployed();

    const tx = registrar.connect(user).initialize(
      zns.accessController.address,
      randomUser.address,
      randomUser.address,
      randomUser.address,
      randomUser.address,
    );

    await expect(tx).to.be.revertedWith(getAccessRevertMsg(user.address, ADMIN_ROLE));
  });

  it("Should NOT initialize twice", async () => {
    const tx = zns.registrar.connect(deployer).initialize(
      zns.accessController.address,
      randomUser.address,
      randomUser.address,
      randomUser.address,
      randomUser.address,
    );

    await expect(tx).to.be.revertedWith("Initializable: contract is already initialized");
  });

  describe("General functionality", () => {
    it("#coreRegister() should revert if called by address without REGISTRAR_ROLE", async () => {
      const isRegistrar = await zns.accessController.hasRole(REGISTRAR_ROLE, randomUser.address);
      expect(isRegistrar).to.be.false;

      await expect(
        zns.registrar.connect(randomUser).coreRegister(
          ethers.constants.HashZero,
          ethers.constants.HashZero,
          "randomname",
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
        )
      ).to.be.revertedWith(
        getAccessRevertMsg(randomUser.address, REGISTRAR_ROLE)
      );
    });

    it("#coreRevoke() should revert if called by address without REGISTRAR_ROLE", async () => {
      const isRegistrar = await zns.accessController.hasRole(REGISTRAR_ROLE, randomUser.address);
      expect(isRegistrar).to.be.false;

      await expect(
        zns.registrar.connect(randomUser).coreRevoke(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
        )
      ).to.be.revertedWith(
        getAccessRevertMsg(randomUser.address, REGISTRAR_ROLE)
      );
    });

    it("#isOwnerOf() returns correct bools", async () => {
      const topLevelTx = await defaultRootRegistration({
        user,
        zns,
        domainName: defaultDomain,
      });
      const domainHash = await getDomainHashFromReceipt(topLevelTx);
      const tokenId = BigNumber.from(domainHash);

      const isOwnerOfBothUser = await zns.registrar.isOwnerOf(
        domainHash,
        user.address,
        OwnerOf.BOTH
      );
      expect(isOwnerOfBothUser).to.be.true;

      const isOwnerOfBothRandom = await zns.registrar.isOwnerOf(
        domainHash,
        randomUser.address,
        OwnerOf.BOTH
      );
      expect(isOwnerOfBothRandom).to.be.false;

      // transfer token
      await zns.domainToken.connect(user).transferFrom(user.address, randomUser.address, tokenId);
      const isOwnerOfTokenUser = await zns.registrar.isOwnerOf(
        domainHash,
        user.address,
        OwnerOf.TOKEN
      );
      expect(isOwnerOfTokenUser).to.be.false;

      const isOwnerOfTokenRandom = await zns.registrar.isOwnerOf(
        domainHash,
        randomUser.address,
        OwnerOf.TOKEN
      );
      expect(isOwnerOfTokenRandom).to.be.true;

      const isOwnerOfNameUser = await zns.registrar.isOwnerOf(
        domainHash,
        user.address,
        OwnerOf.NAME
      );
      expect(isOwnerOfNameUser).to.be.true;

      const isOwnerOfNameRandom = await zns.registrar.isOwnerOf(
        domainHash,
        randomUser.address,
        OwnerOf.NAME
      );
      expect(isOwnerOfNameRandom).to.be.false;

      await expect(
        zns.registrar.isOwnerOf(domainHash, user.address, 3)
      ).to.be.reverted;
    });

    it("#setSubdomainRegistrar() should revert if called by address without ADMIN_ROLE", async () => {
      const isAdmin = await zns.accessController.hasRole(ADMIN_ROLE, randomUser.address);
      expect(isAdmin).to.be.false;

      await expect(
        zns.registrar.connect(randomUser).setSubdomainRegistrar(randomUser.address)
      ).to.be.revertedWith(
        getAccessRevertMsg(randomUser.address, ADMIN_ROLE)
      );
    });

    it("#setSubdomainRegistrar() should set the correct address", async () => {
      await zns.registrar.connect(admin).setSubdomainRegistrar(randomUser.address);

      expect(
        await zns.registrar.subdomainRegistrar()
      ).to.equal(randomUser.address);
    });

    it("#setSubdomainRegistrar() should NOT set the address to zero address", async () => {
      await expect(
        zns.registrar.connect(admin).setSubdomainRegistrar(ethers.constants.AddressZero)
      ).to.be.revertedWith(
        "ZNSRegistrar: subdomainRegistrar_ is 0x0 address"
      );
    });
  });

  describe("Registers a top level domain", () => {
    it("Can NOT register a TLD with an empty name", async () => {
      const emptyName = "";

      await expect(
        defaultRootRegistration({
          user: deployer,
          zns,
          domainName: emptyName,
        })
      ).to.be.revertedWith("ZNSRegistrar: Domain Name not provided");
    });

    // eslint-disable-next-line max-len
    it("Successfully registers a domain without a resolver or resolver content and fires a #DomainRegistered event", async () => {
      const tx = await zns.registrar.connect(user).registerDomain(
        defaultDomain,
        ethers.constants.AddressZero,
        distrConfigEmpty
      );

      const hashFromTS = hashDomainLabel(defaultDomain);

      await expect(tx).to.emit(zns.registrar, "DomainRegistered").withArgs(
        ethers.constants.HashZero,
        hashFromTS,
        BigNumber.from(hashFromTS),
        defaultDomain,
        user.address,
        ethers.constants.AddressZero,
      );
    });

    it("Successfully registers a domain with distrConfig and adds it to state properly", async () => {
      const distrConfig = {
        pricingContract: zns.fixedPricing.address,
        paymentContract: zns.directPayment.address,
        accessType: AccessType.OPEN,
      };

      const tx = await zns.registrar.connect(user).registerDomain(
        defaultDomain,
        ethers.constants.AddressZero,
        distrConfig
      );

      const receipt = await tx.wait(0);

      const domainHash = await getDomainHashFromReceipt(receipt);

      const {
        pricingContract,
        paymentContract,
        accessType,
      } = await zns.subdomainRegistrar.distrConfigs(domainHash);

      expect(pricingContract).to.eq(distrConfig.pricingContract);
      expect(paymentContract).to.eq(distrConfig.paymentContract);
      expect(accessType).to.eq(distrConfig.accessType);
    });

    it("Stakes the correct amount, takes the correct fee and sends fee to Zero Vault", async () => {
      const balanceBeforeUser = await zns.zeroToken.balanceOf(user.address);
      const balanceBeforeVault = await zns.zeroToken.balanceOf(zeroVault.address);

      // Deploy "wilder" with default configuration
      const tx = await defaultRootRegistration({
        user,
        zns,
        domainName: defaultDomain,
      });
      const domainHash = await getDomainHashFromReceipt(tx);
      const {
        totalPrice,
        expectedPrice,
        fee,
      } = await getPriceObject(defaultDomain, priceConfigDefault);

      await checkBalance({
        token: zns.zeroToken,
        balanceBefore: balanceBeforeUser,
        userAddress: user.address,
        target: totalPrice,
      });

      await checkBalance({
        token: zns.zeroToken,
        balanceBefore: balanceBeforeVault,
        userAddress: zeroVault.address,
        target: fee,
        shouldDecrease: false,
      });

      const staked = await zns.treasury.stakedForDomain(domainHash);

      expect(staked).to.eq(expectedPrice);
    });

    it("Sets the correct data in Registry", async () => {
      const tx = await defaultRootRegistration({
        user,
        zns,
        domainName: defaultDomain,
      });

      const namehashRef = hashDomainLabel(defaultDomain);
      const domainHash = await getDomainHashFromReceipt(tx);
      expect(domainHash).to.eq(namehashRef);

      const {
        owner: ownerFromReg,
        resolver: resolverFromReg,
      } = await zns.registry.getDomainRecord(domainHash);

      expect(ownerFromReg).to.eq(user.address);
      expect(resolverFromReg).to.eq(zns.addressResolver.address);
    });

    it("Fails when the user does not have enough funds", async () => {
      await zns.zeroToken.connect(user).transfer(zns.zeroToken.address, priceConfigDefault.maxPrice);

      const tx = defaultRootRegistration({
        user,
        zns,
        domainName: defaultDomain,
      });
      await expect(tx).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });

    // eslint-disable-next-line max-len
    it("Allows unicode characters in domain names and matches the hash of normalized string acquired from namehash library", async () => {
      const unicodeDomainLabel = "œ柸þ€§ﾪ";

      const normalizedDomainLabel = normalizeName(unicodeDomainLabel);

      const tx = await defaultRootRegistration({
        user,
        zns,
        domainName: normalizedDomainLabel,
      });

      const domainHash = await getDomainHashFromReceipt(tx);
      // validate that namehash lib works the same way as our contract hashing
      // TODO: a security issue with namehash lib is the usage of non-ASCII characters
      //  this should be handled at the SDK/dApp level!
      const namehashRef = hashDomainLabel(unicodeDomainLabel);
      expect(domainHash).to.eq(namehashRef);
      expect(await zns.registry.exists(domainHash)).to.be.true;

      const expectedStaked = await calcAsymptoticPrice(normalizedDomainLabel, priceConfigDefault);
      const staked = await zns.treasury.stakedForDomain(domainHash);
      expect(expectedStaked).to.eq(staked);
    });

    it("Disallows creation of a duplicate domain", async () => {
      await defaultRootRegistration({
        user,
        zns,
        domainName: defaultDomain,
      });
      const failTx = defaultRootRegistration({
        user: deployer,
        zns,
        domainName: defaultDomain,
      });

      await expect(failTx).to.be.revertedWith("ZNSRegistrar: Domain already exists");
    });

    it("Successfully registers a domain without resolver content", async () => {
      const tx = zns.registrar.connect(user).registerDomain(
        defaultDomain,
        ethers.constants.AddressZero,
        distrConfigEmpty
      );

      await expect(tx).to.not.be.reverted;
    });

    it("Records the correct domain hash", async () => {
      const tx = await defaultRootRegistration({
        user,
        zns,
        domainName: defaultDomain,
      });

      const domainHash = await getDomainHashFromReceipt(tx);

      const exists = await zns.registry.exists(domainHash);
      expect(exists).to.be.true;
      expect(domainHash).to.eq(hashDomainLabel(defaultDomain));
    });

    it("Creates and finds the correct tokenId", async () => {
      const tx = await defaultRootRegistration({
        user,
        zns,
        domainName: defaultDomain,
      });

      const tokenId = await getTokenIdFromReceipt(tx);
      const owner = await zns.domainToken.ownerOf(tokenId);
      expect(owner).to.eq(user.address);
    });

    it("Resolves the correct address from the domain", async () => {
      const tx = await defaultRootRegistration({
        user,
        zns,
        domainName: defaultDomain,
        domainContent: zns.registrar.address,
      });
      const domainHash = await getDomainHashFromReceipt(tx);

      const resolvedAddress = await zns.addressResolver.getAddress(domainHash);
      expect(resolvedAddress).to.eq(zns.registrar.address);
    });
  });

  describe("Reclaiming Domains", () => {
    it("Can reclaim name/stake if Token is owned", async () => {
      // Register Top level
      const topLevelTx = await defaultRootRegistration({ user: deployer, zns, domainName: defaultDomain });
      const domainHash = await getDomainHashFromReceipt(topLevelTx);
      const tokenId = await getTokenIdFromReceipt(topLevelTx);
      const staked = await zns.treasury.stakedForDomain(domainHash);

      // Transfer the domain token
      await zns.domainToken.connect(deployer).transferFrom(deployer.address, user.address, tokenId);

      // Verify owner in registry
      const originalOwner  = await zns.registry.connect(deployer).getDomainOwner(domainHash);
      expect(originalOwner).to.equal(deployer.address);

      // Reclaim the Domain
      await zns.registrar.connect(user).reclaimDomain(domainHash);

      // Verify domain token is still owned
      const owner  = await zns.domainToken.connect(user).ownerOf(tokenId);
      expect(owner).to.equal(user.address);

      // Verify domain is owned in registry
      const registryOwner = await zns.registry.connect(user).getDomainOwner(domainHash);
      expect(registryOwner).to.equal(user.address);

      // Verify same amount is staked
      const stakedAfterReclaim = await zns.treasury.stakedForDomain(domainHash);
      expect(staked).to.equal(stakedAfterReclaim);
    });

    it("Reclaiming domain token emits DomainReclaimed event", async () => {
      const topLevelTx = await defaultRootRegistration({ user: deployer, zns, domainName: defaultDomain });
      const domainHash = await getDomainHashFromReceipt(topLevelTx);
      const tokenId = await getTokenIdFromReceipt(topLevelTx);

      // Transfer the domain token
      await zns.domainToken.connect(deployer).transferFrom(deployer.address, user.address, tokenId);
      // Reclaim the Domain
      const tx = await zns.registrar.connect(user).reclaimDomain(domainHash);
      const receipt = await tx.wait(0);

      // Verify Transfer event is emitted
      expect(receipt.events?.[1].event).to.eq("DomainReclaimed");
      expect(receipt.events?.[1].args?.domainHash).to.eq(
        domainHash
      );
      expect(receipt.events?.[1].args?.registrant).to.eq(
        user.address
      );
    });

    it("Cannot reclaim name/stake if token is not owned", async () => {
      const topLevelTx = await defaultRootRegistration({ user: deployer, zns, domainName: defaultDomain });
      const domainHash = await getDomainHashFromReceipt(topLevelTx);
      // Reclaim the Domain
      const tx = zns.registrar.connect(user).reclaimDomain(domainHash);

      // Verify Domain is not reclaimed
      await expect(tx).to.be.revertedWith(NOT_TOKEN_OWNER_RAR_ERR);

      // Verify domain is not owned in registrar
      const registryOwner = await zns.registry.connect(user).getDomainOwner(domainHash);
      expect(registryOwner).to.equal(deployer.address);
    });

    it("Cannot reclaim if domain does not exist", async () => {
      const domainHash = "0xd34cfa279afd55afc6aa9c00aa5d01df60179840a93d10eed730058b8dd4146c";
      // Reclaim the Domain
      const tx = zns.registrar.connect(user).reclaimDomain(domainHash);

      // Verify Domain is not reclaimed
      await expect(tx).to.be.revertedWith(INVALID_TOKENID_ERC_ERR);
    });

    it("Domain Token can be reclaimed, transferred, and then reclaimed again", async () => {
      // Register Top level
      const topLevelTx = await defaultRootRegistration({ user: deployer, zns, domainName: defaultDomain });
      const domainHash = await getDomainHashFromReceipt(topLevelTx);
      const tokenId = await getTokenIdFromReceipt(topLevelTx);
      const staked = await zns.treasury.stakedForDomain(domainHash);

      // Transfer the domain token
      await zns.domainToken.connect(deployer).transferFrom(deployer.address, user.address, tokenId);

      // Reclaim the Domain
      await zns.registrar.connect(user).reclaimDomain(domainHash);
      // Verify domain token is still owned
      let owner  = await zns.domainToken.connect(user).ownerOf(tokenId);
      expect(owner).to.equal(user.address);

      // Transfer the domain token back
      await zns.domainToken.connect(user).transferFrom(user.address, deployer.address, tokenId);

      // Reclaim the Domain again
      await zns.registrar.connect(deployer).reclaimDomain(domainHash);

      // Verify domain token is owned
      owner  = await zns.domainToken.connect(deployer).ownerOf(tokenId);
      expect(owner).to.equal(deployer.address);

      // Verify domain is owned in registrar
      const registryOwner = await zns.registry.connect(deployer).getDomainOwner(domainHash);
      expect(registryOwner).to.equal(deployer.address);

      // Verify same amount is staked
      const stakedAfterReclaim = await zns.treasury.stakedForDomain(domainHash);
      expect(staked).to.equal(stakedAfterReclaim);
    });

    it("Can revoke and unstake after reclaiming", async () => {

      // Verify Balance
      const balance = await zns.zeroToken.balanceOf(user.address);
      expect(balance).to.eq(priceConfigDefault.maxPrice);

      // Register Top level
      const topLevelTx = await defaultRootRegistration({ user: deployer, zns, domainName: defaultDomain });
      const domainHash = await getDomainHashFromReceipt(topLevelTx);
      const tokenId = await getTokenIdFromReceipt(topLevelTx);

      // Validated staked values
      const {
        expectedPrice: expectedStaked,
      } = await getPriceObject(defaultDomain, priceConfigDefault);
      const staked = await zns.treasury.stakedForDomain(domainHash);
      expect(staked).to.eq(expectedStaked);

      // Transfer the domain token
      await zns.domainToken.connect(deployer).transferFrom(deployer.address, user.address, tokenId);

      // Reclaim the Domain
      await zns.registrar.connect(user).reclaimDomain(domainHash);

      // Revoke the Domain
      await zns.registrar.connect(user).revokeDomain(domainHash);

      // Validated funds are unstaked
      const finalstaked = await zns.treasury.stakedForDomain(domainHash);
      expect(finalstaked).to.equal(ethers.BigNumber.from("0"));

      // Verify final balances
      const computedFinalBalance = balance.add(staked);
      const finalBalance = await zns.zeroToken.balanceOf(user.address);
      expect(computedFinalBalance).to.equal(finalBalance);
    });
  });

  describe("Revoking Domains", () => {
    it("Revokes a Top level Domain - Happy Path", async () => {
      // Register Top level
      const topLevelTx = await defaultRootRegistration({
        user,
        zns,
        domainName: defaultDomain,
        distrConfig: {
          pricingContract: zns.fixedPricing.address,
          paymentContract: zns.directPayment.address,
          accessType: AccessType.OPEN,
        },
      });

      const domainHash = await getDomainHashFromReceipt(topLevelTx);

      const ogPrice = BigNumber.from(135);
      await zns.fixedPricing.connect(user).setPrice(domainHash, ogPrice);
      expect(await zns.fixedPricing.getPrice(domainHash, defaultDomain)).to.eq(ogPrice);

      const tokenId = await getTokenIdFromReceipt(topLevelTx);

      // Revoke the domain and then verify
      const tx = await zns.registrar.connect(user).revokeDomain(domainHash);

      // Verify token has been burned
      const ownerOfTx = zns.domainToken.connect(user).ownerOf(tokenId);
      await expect(ownerOfTx).to.be.revertedWith(
        INVALID_TOKENID_ERC_ERR
      );

      // Verify Domain Record Deleted
      const exists = await zns.registry.exists(domainHash);
      expect(exists).to.be.false;

      // validate price has been reset
      expect(
        await zns.fixedPricing.getPrice(domainHash, defaultDomain)
      ).to.eq(ethers.constants.Zero);
    });

    it("Cannot revoke a domain that doesnt exist", async () => {
    // Register Top level
      const fakeHash = "0xd34cfa279afd55afc6aa9c00aa5d01df60179840a93d10eed730058b8dd4146c";
      const exists = await zns.registry.exists(fakeHash);
      expect(exists).to.be.false;

      // Verify transaction is reverted
      const tx = zns.registrar.connect(user).revokeDomain(fakeHash);
      await expect(tx).to.be.revertedWith(NOT_BOTH_OWNER_RAR_ERR);
    });

    it("Revoking domain unstakes", async () => {
    // Verify Balance
      const balance = await zns.zeroToken.balanceOf(user.address);
      expect(balance).to.eq(priceConfigDefault.maxPrice);

      // Register Top level
      const tx = await defaultRootRegistration({ user, zns, domainName: defaultDomain });
      const domainHash = await getDomainHashFromReceipt(tx);

      // Validated staked values
      const {
        expectedPrice: expectedStaked,
        fee: expectedStakeFee,
      } = await getPriceObject(defaultDomain, priceConfigDefault);
      const staked = await zns.treasury.stakedForDomain(domainHash);
      expect(staked).to.eq(expectedStaked);

      // Get balance after staking
      const balanceAfterStaking = await zns.zeroToken.balanceOf(user.address);

      // Revoke the domain
      await zns.registrar.connect(user).revokeDomain(domainHash);

      // Validated funds are unstaked
      const finalstaked = await zns.treasury.stakedForDomain(domainHash);
      expect(finalstaked).to.equal(ethers.BigNumber.from("0"));

      // Verify final balances
      const computedBalanceAfterStaking = balanceAfterStaking.add(staked);
      const balanceMinusFee = balance.sub(expectedStakeFee);
      expect(computedBalanceAfterStaking).to.equal(balanceMinusFee);
      const finalBalance = await zns.zeroToken.balanceOf(user.address);
      expect(computedBalanceAfterStaking).to.equal(finalBalance);
    });

    it("Cannot revoke if Name is owned by another user", async () => {
    // Register Top level
      const topLevelTx = await defaultRootRegistration({ user: deployer, zns, domainName: defaultDomain });
      const parentDomainHash = await getDomainHashFromReceipt(topLevelTx);
      const owner = await zns.registry.connect(user).getDomainOwner(parentDomainHash);
      expect(owner).to.not.equal(user.address);

      // Try to revoke domain
      const tx = zns.registrar.connect(user).revokeDomain(parentDomainHash);
      await expect(tx).to.be.revertedWith(NOT_BOTH_OWNER_RAR_ERR);
    });

    it("No one can revoke if Token and Name have different owners", async () => {
      // Register Top level
      const topLevelTx = await defaultRootRegistration({ user: deployer, zns, domainName: defaultDomain });
      const parentDomainHash = await getDomainHashFromReceipt(topLevelTx);
      const owner = await zns.registry.connect(user).getDomainOwner(parentDomainHash);
      expect(owner).to.not.equal(user.address);

      const tokenId = BigNumber.from(parentDomainHash);

      await zns.domainToken.transferFrom(deployer.address, user.address, tokenId);

      // Try to revoke domain as a new owner of the token
      const tx = zns.registrar.connect(user).revokeDomain(parentDomainHash);
      await expect(tx).to.be.revertedWith(NOT_BOTH_OWNER_RAR_ERR);

      const tx2 = zns.registrar.connect(deployer).revokeDomain(parentDomainHash);
      await expect(tx2).to.be.revertedWith(NOT_BOTH_OWNER_RAR_ERR);
    });

    it("After domain has been revoked, an old operator can NOT access Registry", async () => {
      // Register Top level
      const tx = await defaultRootRegistration({ user, zns, domainName: defaultDomain });
      const domainHash = await getDomainHashFromReceipt(tx);

      // assign an operator
      await zns.registry.connect(user).setOwnerOperator(operator.address, true);

      // Revoke the domain
      await zns.registrar.connect(user).revokeDomain(domainHash);

      // check operator access to the revoked domain
      const tx2 = zns.registry
        .connect(operator)
        .updateDomainOwner(
          domainHash,
          operator.address
        );
      await expect(tx2).to.be.revertedWith(
        ONLY_OWNER_REGISTRAR_REG_ERR
      );

      const tx3 = zns.registry
        .connect(operator)
        .updateDomainRecord(
          domainHash,
          user.address,
          operator.address
        );
      await expect(tx3).to.be.revertedWith(
        ONLY_NAME_OWNER_REG_ERR
      );

      const tx4 = zns.registry
        .connect(operator)
        .updateDomainResolver(
          domainHash,
          zeroVault.address
        );
      await expect(tx4).to.be.revertedWith(
        NOT_AUTHORIZED_REG_ERR
      );
    });
  });

  describe("State Setters", () => {
    describe("#setAccessController", () => {
      it("Should set AccessController and fire AccessControllerSet event", async () => {
        const currentAC = await zns.registrar.getAccessController();
        const tx = await zns.registrar.connect(deployer).setAccessController(randomUser.address);
        const newAC = await zns.registrar.getAccessController();

        await expect(tx).to.emit(zns.registrar, "AccessControllerSet").withArgs(randomUser.address);

        expect(newAC).to.equal(randomUser.address);
        expect(currentAC).to.not.equal(newAC);
      });

      it("Should revert if not called by ADMIN", async () => {
        const tx = zns.registrar.connect(user).setAccessController(randomUser.address);
        await expect(tx).to.be.revertedWith(
          getAccessRevertMsg(user.address, ADMIN_ROLE)
        );
      });

      it("Should revert if new AccessController is address zero", async () => {
        const tx = zns.registrar.connect(deployer).setAccessController(ethers.constants.AddressZero);
        await expect(tx).to.be.revertedWith("AC: _accessController is 0x0 address");
      });
    });

    describe("#setZnsRegistry", () => {
      it("Should set ZNSRegistry and fire RegistrySet event", async () => {
        const currentRegistry = await zns.registrar.registry();
        const tx = await zns.registrar.connect(deployer).setRegistry(randomUser.address);
        const newRegistry = await zns.registrar.registry();

        await expect(tx).to.emit(zns.registrar, "RegistrySet").withArgs(randomUser.address);

        expect(newRegistry).to.equal(randomUser.address);
        expect(currentRegistry).to.not.equal(newRegistry);
      });

      it("Should revert if not called by ADMIN", async () => {
        const tx = zns.registrar.connect(user).setRegistry(randomUser.address);
        await expect(tx).to.be.revertedWith(
          getAccessRevertMsg(user.address, ADMIN_ROLE)
        );
      });

      it("Should revert if ZNSRegistry is address zero", async () => {
        const tx = zns.registrar.connect(deployer).setRegistry(ethers.constants.AddressZero);
        await expect(tx).to.be.revertedWith("ARegistryWired: _registry can not be 0x0 address");
      });
    });

    describe("#setTreasury", () => {
      it("Should set Treasury and fire TreasurySet event", async () => {
        const currentTreasury = await zns.registrar.treasury();
        const tx = await zns.registrar.connect(deployer).setTreasury(randomUser.address);
        const newTreasury = await zns.registrar.treasury();

        await expect(tx).to.emit(zns.registrar, "TreasurySet").withArgs(randomUser.address);

        expect(newTreasury).to.equal(randomUser.address);
        expect(currentTreasury).to.not.equal(newTreasury);
      });

      it("Should revert if not called by ADMIN", async () => {
        const tx = zns.registrar.connect(user).setTreasury(randomUser.address);
        await expect(tx).to.be.revertedWith(
          getAccessRevertMsg(user.address, ADMIN_ROLE)
        );
      });

      it("Should revert if Treasury is address zero", async () => {
        const tx = zns.registrar.connect(deployer).setTreasury(ethers.constants.AddressZero);
        await expect(tx).to.be.revertedWith("ZNSRegistrar: treasury_ is 0x0 address");
      });
    });

    describe("#setDomainToken", () => {
      it("Should set DomainToken and fire DomainTokenSet event", async () => {
        const currentToken = await zns.registrar.domainToken();
        const tx = await zns.registrar.connect(deployer).setDomainToken(randomUser.address);
        const newToken = await zns.registrar.domainToken();

        await expect(tx).to.emit(zns.registrar, "DomainTokenSet").withArgs(randomUser.address);

        expect(newToken).to.equal(randomUser.address);
        expect(currentToken).to.not.equal(newToken);
      });

      it("Should revert if not called by ADMIN", async () => {
        const tx = zns.registrar.connect(user).setDomainToken(randomUser.address);
        await expect(tx).to.be.revertedWith(
          getAccessRevertMsg(user.address, ADMIN_ROLE)
        );
      });

      it("Should revert if DomainToken is address zero", async () => {
        const tx = zns.registrar.connect(deployer).setDomainToken(ethers.constants.AddressZero);
        await expect(tx).to.be.revertedWith("ZNSRegistrar: domainToken_ is 0x0 address");
      });
    });

    describe("#setAddressResolver", () => {
      it("Should set AddressResolver and fire AddressResolverSet event", async () => {
        const currentResolver = await zns.registrar.addressResolver();
        const tx = await zns.registrar.connect(deployer).setAddressResolver(randomUser.address);
        const newResolver = await zns.registrar.addressResolver();

        await expect(tx).to.emit(zns.registrar, "AddressResolverSet").withArgs(randomUser.address);

        expect(newResolver).to.equal(randomUser.address);
        expect(currentResolver).to.not.equal(newResolver);
      });

      it("Should revert if not called by ADMIN", async () => {
        const tx = zns.registrar.connect(user).setAddressResolver(randomUser.address);
        await expect(tx).to.be.revertedWith(
          getAccessRevertMsg(user.address, ADMIN_ROLE)
        );
      });

      it("Should revert if AddressResolver is address zero", async () => {
        const tx = zns.registrar.connect(deployer).setAddressResolver(ethers.constants.AddressZero);
        await expect(tx).to.be.revertedWith("ZNSRegistrar: addressResolver_ is 0x0 address");
      });
    });
  });

  describe("UUPS", () => {
    it("Allows an authorized user to upgrade the contract", async () => {
      // Confirm deployer has the correct role first
      await expect(zns.accessController.checkGovernor(deployer.address)).to.not.be.reverted;

      const registrarFactory = new ZNSRegistrar__factory(deployer);
      const registrar = await registrarFactory.deploy();
      await registrar.deployed();

      const upgradeTx = zns.registrar.connect(deployer).upgradeTo(registrar.address);
      await expect(upgradeTx).to.not.be.reverted;
    });

    it("Fails to upgrade when an unauthorized users calls", async () => {
      const registrarFactory = new ZNSRegistrar__factory(deployer);
      const registrar = await registrarFactory.deploy();
      await registrar.deployed();

      const tx = zns.registrar.connect(randomUser).upgradeTo(registrar.address);

      await expect(tx).to.be.revertedWith(
        getAccessRevertMsg(randomUser.address, GOVERNOR_ROLE)
      );
    });

    it("Verifies that variable values are not changed in the upgrade process", async () => {
      // Confirm deployer has the correct role first
      await expect(zns.accessController.checkGovernor(deployer.address)).to.not.be.reverted;

      const registrarFactory = new ZNSRegistrarUpgradeMock__factory(deployer);
      const registrar = await registrarFactory.deploy();
      await registrar.deployed();

      const domainName = "world";
      const domainHash = hashDomainLabel(domainName);

      await zns.zeroToken.connect(randomUser).approve(zns.treasury.address, ethers.constants.MaxUint256);
      await zns.zeroToken.mint(randomUser.address, priceConfigDefault.maxPrice);

      await zns.registrar.connect(randomUser).registerDomain(
        domainName,
        randomUser.address,
        distrConfigEmpty
      );

      await zns.registrar.setAddressResolver(randomUser.address);

      const contractCalls = [
        zns.registrar.getAccessController(),
        zns.registrar.registry(),
        zns.registrar.treasury(),
        zns.registrar.domainToken(),
        zns.registrar.addressResolver(),
        zns.registry.exists(domainHash),
        zns.treasury.stakedForDomain(domainHash),
        zns.domainToken.name(),
        zns.domainToken.symbol(),
        zns.priceOracle.getPrice(domainName),
      ];

      await validateUpgrade(deployer, zns.registrar, registrar, registrarFactory, contractCalls);
    });
  });

  // TODO sub: add tests for the new config setter flow
});
