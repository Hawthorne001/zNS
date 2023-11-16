import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { IDeployCampaignConfig } from "./types";
import {
  DEFAULT_REGISTRATION_FEE_PERCENT,
  DEFAULT_ROYALTY_FRACTION,
  ZNS_DOMAIN_TOKEN_NAME,
  ZNS_DOMAIN_TOKEN_SYMBOL,
  DEFAULT_DECIMALS,
  DECAULT_PRECISION,
  DEFAULT_PRICE_CONFIG,
} from "../../../test/helpers";
import { ethers } from "ethers";
import { ICurvePriceConfig } from "../missions/types";

import { MeowMainnet } from "../missions/contracts/meow-token/mainnet-data";

const getCustomAddresses = (
  key : string,
  account : SignerWithAddress,
  accounts ?: Array<string>
) => {
  const addresses = [];

  if (process.env[key]) {
    /* eslint-disable @typescript-eslint/no-non-null-assertion */
    const decoded = atob(process.env[key]!);

    // Check if there is more than one custom governor
    if (decoded.includes(",")) {
      addresses.push(...decoded.split(","));
    } else {
      addresses.push(decoded);
    }
  }

  if (addresses.length === 0) {
    if (accounts && accounts.length > 0) {
      addresses.push(...accounts); // The user provided custom governors / admins as a param for testing
    } else {
      addresses.push(account.address); // No custom governors / admins provided, use the deployer as the default
    }
  }
  return addresses;
};

// This function builds a config with default values but overrides them with any values that are set
export const getConfig = (
  account : SignerWithAddress,
  zeroVault : SignerWithAddress,
  governors ?: Array<string>,
  admins ?: Array<string>,
) : IDeployCampaignConfig => {
  // Price config variables
  const maxPrice =
    process.env.MAX_PRICE
      ? ethers.utils.parseEther(process.env.MAX_PRICE)
      : DEFAULT_PRICE_CONFIG.maxPrice;

  const minPrice =
    process.env.MIN_PRICE
      ? ethers.utils.parseEther(process.env.MIN_PRICE)
      : DEFAULT_PRICE_CONFIG.minPrice;

  const maxLength =
    process.env.MAX_LENGTH
      ? ethers.BigNumber.from(process.env.MAX_LENGTH)
      : DEFAULT_PRICE_CONFIG.maxLength;

  const baseLength =
    process.env.BASE_LENGTH
      ? ethers.BigNumber.from(process.env.BASE_LENGTH)
      : DEFAULT_PRICE_CONFIG.baseLength;

  const decimals = process.env.DECIMALS ? ethers.BigNumber.from(process.env.DECIMALS) : DEFAULT_DECIMALS;
  const precision = process.env.PRECISION ? ethers.BigNumber.from(process.env.PRECISION) : DECAULT_PRECISION;
  const precisionMultiplier = ethers.BigNumber.from(10).pow(decimals.sub(precision));

  const feePercentage =
    process.env.REG_FEE_PERCENT
      ? ethers.BigNumber.from(process.env.REG_FEE_PERCENT)
      : DEFAULT_REGISTRATION_FEE_PERCENT;
  const royaltyReceiver =
    process.env.ROYALTY_RECEIVER
      ? process.env.ROYALTY_RECEIVER
      : account.address;
  const royaltyFraction =
    process.env.ROYALTY_FRACTION
      ? ethers.BigNumber.from(process.env.ROYALTY_FRACTION)
      : DEFAULT_ROYALTY_FRACTION;

  const priceConfig : ICurvePriceConfig = {
    maxPrice,
    minPrice,
    maxLength,
    baseLength,
    precisionMultiplier,
    feePercentage,
    isSet: true,
  };

  // Get governor addresses set through env, if any
  const governorAddresses = getCustomAddresses("GOVERNOR_ADDRESSES", account, governors);

  // Get admin addresses set through env, if any
  const adminAddresses = getCustomAddresses("ADMIN_ADDRESSES", account, admins);

  const config : IDeployCampaignConfig = {
    deployAdmin: account,
    governorAddresses,
    adminAddresses,
    domainToken: {
      name: process.env.TOKEN_NAME ? process.env.TOKEN_NAME : ZNS_DOMAIN_TOKEN_NAME,
      symbol: process.env.TOKEN_SYMBOL ? process.env.TOKEN_SYMBOL : ZNS_DOMAIN_TOKEN_SYMBOL,
      defaultRoyaltyReceiver: royaltyReceiver,
      defaultRoyaltyFraction: royaltyFraction,
    },
    rootPriceConfig: priceConfig,
    zeroVaultAddress: process.env.ZERO_VAULT_ADDRESS ? process.env.ZERO_VAULT_ADDRESS : zeroVault.address,
    mockMeowToken: process.env.MOCK_MEOW_TOKEN ? !!process.env.MOCK_MEOW_TOKEN : true,
    stakingTokenAddress: process.env.STAKING_TOKEN_ADDRESS ? process.env.STAKING_TOKEN_ADDRESS : MeowMainnet.address,
  };

  return config;
};
