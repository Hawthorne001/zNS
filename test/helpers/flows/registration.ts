import { IDomainConfigForTest, ZNSContracts, IPathRegResult, IASPriceConfig } from "../types";
import { registrationWithSetup } from "../register-setup";
import { BigNumber, ethers } from "ethers";
import assert from "assert";
import { getPriceObject } from "../pricing";
import { expect } from "chai";
import { getDomainRegisteredEvents } from "../events";
import { IERC20__factory, ZNSAsymptoticPricing } from "../../../typechain";


// TODO sub: make these messy helpers better or no one will be able to maintain this
export const registerDomainPath = async ({
  zns,
  domainConfigs,
} : {
  zns : ZNSContracts;
  domainConfigs : Array<IDomainConfigForTest>;
}) => domainConfigs.reduce(
  async (
    acc : Promise<Array<IPathRegResult>>,
    config,
    idx
  ) => {
    const newAcc = await acc;

    let parentHash = config.parentHash;
    if (!parentHash) {
      parentHash = !!newAcc[idx - 1]
        ? newAcc[idx - 1].domainHash
        : ethers.constants.HashZero;
    }

    const isRootDomain = parentHash === ethers.constants.HashZero;

    // determine the price based on the pricing contract in the config
    // and get the necessary contracts based on parent config
    let totalPrice;
    let price = BigNumber.from(0);
    let fee = BigNumber.from(0);
    let paymentTokenContract;
    let paymentContract;
    let pricingContract;
    let beneficiary;

    if (isRootDomain) {
      ({ totalPrice } = await zns.priceOracle.getPrice(config.domainLabel));
      paymentTokenContract = zns.zeroToken;
      paymentContract = zns.treasury;
      beneficiary = zns.zeroVaultAddress;
    } else {
      // grab all the important contracts of the parent
      const {
        pricingContract: pricingContractAddress,
        paymentContract: paymentContractAddress,
      } = await zns.subdomainRegistrar.distrConfigs(parentHash);
      pricingContract = pricingContractAddress === zns.fixedPricing.address
        ? zns.fixedPricing
        : zns.asPricing;
      paymentContract = paymentContractAddress === zns.directPayment.address
        ? zns.directPayment
        : zns.stakePayment;

      const paymentConfig = await paymentContract.getPaymentConfig(parentHash);
      const { paymentToken: paymentTokenAddress } = paymentConfig;
      ({ beneficiary } = paymentConfig);

      if (paymentTokenAddress === zns.zeroToken.address) {
        paymentTokenContract = zns.zeroToken;
      } else {
        const ierc20 = IERC20__factory.connect(paymentTokenAddress, config.user);
        paymentTokenContract = ierc20.attach(paymentTokenAddress);
      }

      if (await pricingContract.feeEnforced()) {
        pricingContract = pricingContract as ZNSAsymptoticPricing;
        ({ price, fee } = await pricingContract.getPriceAndFee(parentHash, config.domainLabel));
        totalPrice = price.add(fee);
      } else {
        totalPrice = await pricingContract.getPrice(parentHash, config.domainLabel);
      }
    }

    // approve the payment amount (price) set by the parent
    await paymentTokenContract.connect(config.user).approve(paymentContract.address, totalPrice);

    const parentBalanceBefore = await paymentTokenContract.balanceOf(beneficiary);
    const userBalanceBefore = await paymentTokenContract.balanceOf(config.user.address);

    const domainHash = await registrationWithSetup({
      zns,
      parentHash,
      isRootDomain,
      ...config,
    });

    const parentBalanceAfter = await paymentTokenContract.balanceOf(beneficiary);
    const userBalanceAfter = await paymentTokenContract.balanceOf(config.user.address);

    const domainObj = {
      domainHash,
      userBalanceBefore,
      userBalanceAfter,
      parentBalanceBefore,
      parentBalanceAfter,
    };

    return [...newAcc, domainObj];
  }, Promise.resolve([])
);

export const validatePathRegistration = async ({
  zns,
  domainConfigs,
  regResults,
} : {
  zns : ZNSContracts;
  domainConfigs : Array<IDomainConfigForTest>;
  regResults : Array<IPathRegResult>;
}) => domainConfigs.reduce(
  async (
    acc,
    {
      user,
      domainLabel,
      parentHash,
    },
    idx
  ) => {
    await acc;

    let expectedPrice : BigNumber;
    let fee = BigNumber.from(0);

    // TODO sub: fix this since it doesn't support partial paths
    //  under existing domains
    // calc only needed for asymptotic pricing, otherwise it is fixed
    let parentHashFound = parentHash;
    if (!parentHashFound) {
      parentHashFound = !!regResults[idx - 1] ? regResults[idx - 1].domainHash : ethers.constants.HashZero;
    }

    const {
      pricingContract,
      paymentContract,
    } = await zns.subdomainRegistrar.distrConfigs(parentHashFound);

    if (pricingContract === zns.asPricing.address) {
      const {
        maxPrice,
        minPrice,
        maxLength,
        baseLength,
        precisionMultiplier,
        feePercentage,
      } = await zns.asPricing.priceConfigs(parentHashFound);

      ({
        expectedPrice,
        fee,
      } = getPriceObject(
        domainLabel,
        {
          maxPrice,
          minPrice,
          maxLength,
          baseLength,
          precisionMultiplier,
          feePercentage,
        },
      ));
    } else {
      expectedPrice = await zns.fixedPricing.getPrice(parentHashFound, domainLabel);
    }

    const {
      domainHash,
      userBalanceBefore,
      userBalanceAfter,
      parentBalanceBefore,
      parentBalanceAfter,
    } = regResults[idx];

    // if parent's payment contract is staking, then beneficiary only gets the fee
    const expParentBalDiff = paymentContract === zns.stakePayment.address
      ? fee
      : expectedPrice.add(fee);

    // fee can be 0
    const expUserBalDiff = expectedPrice.add(fee);

    // check user balance
    expect(userBalanceBefore.sub(userBalanceAfter)).to.eq(expUserBalDiff);
    // check parent balance
    expect(parentBalanceAfter.sub(parentBalanceBefore)).to.eq(expParentBalDiff);

    const dataFromReg = await zns.registry.getDomainRecord(domainHash);
    expect(dataFromReg.owner).to.eq(user.address);
    expect(dataFromReg.resolver).to.eq(zns.addressResolver.address);

    const tokenId = BigNumber.from(domainHash).toString();
    const tokenOwner = await zns.domainToken.ownerOf(tokenId);
    expect(tokenOwner).to.eq(user.address);

    const domainAddress = await zns.addressResolver.getAddress(domainHash);
    expect(domainAddress).to.eq(user.address);

    const events = await getDomainRegisteredEvents({ zns });
    expect(events[events.length - 1].args?.parentHash).to.eq(parentHashFound);
    expect(events[events.length - 1].args?.domainHash).to.eq(domainHash);
    expect(events[events.length - 1].args?.tokenId).to.eq(tokenId);
    expect(events[events.length - 1].args?.name).to.eq(domainLabel);
    expect(events[events.length - 1].args?.registrant).to.eq(user.address);
    expect(events[events.length - 1].args?.resolver).to.eq(zns.addressResolver.address);
    expect(events[events.length - 1].args?.domainAddress).to.eq(user.address);
  }, Promise.resolve()
);
