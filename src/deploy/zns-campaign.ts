import { ICampaignArgs, IDeployCampaignConfig, TLogger } from "./campaign/types";
import { HardhatDeployer } from "./deployer/hardhat-deployer";
import { FileStorageAdapter } from "./storage/file-storage";
import { DeployCampaign } from "./campaign/deploy-campaign";
import {
  MeowTokenMockDM,
  ZNSAccessControllerDM,
  ZNSAddressResolverDM,
  ZNSDomainTokenDM, ZNSCurvePricerDM, ZNSRootRegistrarDM,
  ZNSRegistryDM, ZNSTreasuryDM, ZNSFixedPricerDM, ZNSSubRegistrarDM,
} from "./missions/contracts";
import * as hre from "hardhat";


// TODO dep: add configs for ENV vars in this repo
export const runZnsCampaign = async ({
  config,
  logger,
  writeLocal,
} : {
  config : IDeployCampaignConfig;
  logger : TLogger;
  writeLocal ?: boolean;
}) => {
  // TODO dep: figure out the best place to put this at!
  hre.upgrades.silenceWarnings();

  const deployer = new HardhatDeployer();
  const dbAdapterIn = new FileStorageAdapter(logger, writeLocal);

  const campaign = new DeployCampaign({
    missions: [
      ZNSAccessControllerDM,
      ZNSRegistryDM,
      ZNSDomainTokenDM,
      // TODO dep: add proper class for MeowToken in prod,
      //  that is able to determine to deploy a mock for test
      //  or use the data for existing Meow on mainnet to create and object and save to state
      MeowTokenMockDM,
      ZNSAddressResolverDM,
      ZNSCurvePricerDM,
      ZNSTreasuryDM,
      ZNSRootRegistrarDM,
      ZNSFixedPricerDM,
      ZNSSubRegistrarDM,
    ],
    deployer,
    dbAdapter: dbAdapterIn,
    logger,
    config,
  } as ICampaignArgs);

  await campaign.execute();

  return campaign;
};
