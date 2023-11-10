import { BaseDeployMission } from "../base-deploy-mission";
import { ProxyKinds } from "../../constants";
import { IDeployMissionArgs, TDeployArgs } from "../types";
import { ethers } from "ethers";
import { MeowTokenDM } from "./meow-token/meow-token";
import { znsNames } from "./names";

export class ZNSTreasuryDM extends BaseDeployMission {
  proxyData = {
    isProxy: true,
    kind: ProxyKinds.uups,
  };

  // bool for determining token setup behaviour
  // determined in constructor
  isMockedMeowToken : boolean;
  contractName = znsNames.treasury.contract;
  instanceName = znsNames.treasury.instance;

  constructor (args : IDeployMissionArgs) {
    super(args);

    const {
      config: {
        stakingTokenAddress,
      },
    } = this.campaign;

    if (!!stakingTokenAddress) {
      this.isMockedMeowToken = false;
    } else {
      // TODO dep: is this a correct check? rework this whole flow in the class when MeowTokenDM is done
      if (!this.campaign.state.missions.includes(MeowTokenDM)) throw new Error(
        `No staking token found!
        Please make sure to provide 'stakingTokenAddress' to the config
        or add mocked token to the Deploy Campaign if this is a test.`
      );

      // TODO dep: possibly make an ENV var out of this so that it is known before we get here
      this.isMockedMeowToken = true;
    }
  }

  deployArgs () : TDeployArgs {
    const {
      accessController,
      registry,
      meowToken,
      config: {
        stakingTokenAddress,
        zeroVaultAddress,
      },
    } = this.campaign;

    const stakingToken = !this.isMockedMeowToken
      ? stakingTokenAddress
      : meowToken.address;

    return [
      accessController.address,
      registry.address,
      stakingToken,
      zeroVaultAddress,
    ];
  }

  async needsPostDeploy () : Promise<boolean> {
    return this.isMockedMeowToken;
  }

  // TODO dep: figure out if this is needed to be here so it doesn't run by mistake in prod.
  // this should launch ONLY if the Meow Token was mocked in test !
  async postDeploy () {
    const {
      meowToken,
      treasury,
      config: {
        deployAdmin,
      },
    } = this.campaign;

    // Give allowance to the treasury
    await meowToken.connect(deployAdmin).approve(
      treasury.address,
      ethers.constants.MaxUint256
    );
  }
}
