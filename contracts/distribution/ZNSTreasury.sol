// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import { IZNSTreasury } from "./IZNSTreasury.sol";
import { IZNSEthRegistrar } from "./IZNSEthRegistrar.sol";
import { IZNSPriceOracle } from "./IZNSPriceOracle.sol";
// TODO: fix when token is sorted out
import { IZeroTokenMock } from "../token/mocks/IZeroTokenMock.sol";

// TODO: Make upgradeable
contract ZNSTreasury is IZNSTreasury {
  /**
   * @notice The address of the registrar we are using
   */
  address public znsRegistrar;

  /**
   * @notice The price oracle
   */
  IZNSPriceOracle public znsPriceOracle;

  /**
   * @notice The ZERO ERC20 token
   */
  IZeroTokenMock public zeroToken;

  mapping(bytes32 domainHash => uint256 amountStaked) public stakedForDomain;

  // TODO access control
  mapping(address user => bool isAdmin) public admin;

  modifier onlyRegistrar() {
    require(
      msg.sender == znsRegistrar,
      "ZNSTreasury: Only ZNSRegistrar is allowed to call"
    );
    _;
  }

  modifier onlyAdmin() {
    require(admin[msg.sender], "ZNSTreasury: Not an allowed admin");
    _;
  }

  constructor(
    IZNSPriceOracle znsPriceOracle_,
    IZeroTokenMock zeroToken_,
    address znsRegistrar_,
    address admin_
  ) {
    // TODO change from mock
    zeroToken = zeroToken_;
    znsPriceOracle = znsPriceOracle_;
    znsRegistrar = znsRegistrar_;
    admin[admin_] = true;
  }

  function stakeForDomain(
    bytes32 domainHash,
    string calldata domainName,
    address depositor,
    address burnAddress, // TODO reg: not burning, rename
    bool isTopLevelDomain
  ) external onlyRegistrar {
    // Get price and fee for the domain
    (, uint256 stakeAmount, uint256 registrationFee) = znsPriceOracle.getPrice(
      domainName,
      isTopLevelDomain
    );

    // Transfer stake amount and fee
    zeroToken.transferFrom(depositor, address(this), stakeAmount);
    // TODO make sure we show the approval process to the user here to avoid failed transfer
    zeroToken.transferFrom(depositor, burnAddress, registrationFee);

    // Record staked amount for this domain
    stakedForDomain[domainHash] = stakeAmount;

    emit StakeDeposited(domainHash, domainName, depositor, stakeAmount);
  }

  function getStakedForDomain(
    bytes32 domainHash
  ) public view override returns (uint256) {
    return stakedForDomain[domainHash];
  }

  function unstakeForDomain(
    bytes32 domainHash,
    address owner
  ) external onlyRegistrar {
    uint256 stakeAmount = stakedForDomain[domainHash];
    delete stakedForDomain[domainHash];

    // require owner == ownerOrOperator from registry?
    zeroToken.transfer(owner, stakeAmount);

    emit StakeWithdrawn(domainHash, owner, stakeAmount);
  }

  function setZNSRegistrar(address znsRegistrar_) external onlyAdmin {
    require(
      znsRegistrar_ != address(0),
      "ZNSTreasury: Zero address passed as znsRegistrar"
    );

    znsRegistrar = znsRegistrar_;
    emit ZNSRegistrarSet(znsRegistrar_);
  }

  function setAdmin(address user, bool status) external onlyAdmin {
    require(user != address(0), "ZNSTreasury: No zero address admins");

    // If a user is given Admin status, they can remove any other admin's status as well
    // To protect against this, we require that the user is the sender if setting
    // status to `false`
    if (status == false) {
      require(
        msg.sender == user,
        "ZNSTreasury: Cannot unset another users admin access"
      );
    }

    admin[user] = status;

    emit AdminSet(user, status);
  }

  function isAdmin(address user) external view returns (bool) {
    return admin[user];
  }
}
