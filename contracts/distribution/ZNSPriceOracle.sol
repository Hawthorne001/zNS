// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { IZNSPriceOracle } from "./IZNSPriceOracle.sol";
import { StringUtils } from "../utils/StringUtils.sol";

contract ZNSPriceOracle is IZNSPriceOracle, Initializable {
  using StringUtils for string;
  /**
   * @notice Struct for each configurable price variable
   */
  PriceParams public params;

  /**
   * @notice The address of the ZNS Registrar we are using
   */
  address public znsRegistrar;

  /**
   * @notice Track authorized users or contracts
   * TODO access control for the entire system
   */
  mapping(address user => bool isAuthorized) public authorized;

  /**
   * @notice Restrict a function to only be callable by authorized users
   */
  modifier onlyAuthorized() {
    require(authorized[msg.sender], "ZNS: Not authorized");
    _;
  }

  function initialize(
    PriceParams calldata params_,
    address znsRegistrar_
  ) public initializer {
    // Set pricing and length parameters
    params = params_;

    // Set the user and registrar we allow to modify prices
    znsRegistrar = znsRegistrar_;
    authorized[msg.sender] = true;
    authorized[znsRegistrar_] = true;
  }

  /**
   * @notice Get the price of a given domain name
   * @param name The name of the domain to check
   * @param isRootDomain Flag for which base price to use. True for root, false for subdomains
   */
  function getPrice(
    string calldata name,
    bool isRootDomain
  ) external view returns (uint256) {
    uint256 length = name.strlen();
    // No pricing is set for 0 length domains
    if (length == 0) return 0;

    if (isRootDomain) {
      return
        _getPrice(
          length,
          params.baseRootDomainLength,
          params.maxRootDomainPrice,
          params.maxRootDomainLength,
          params.minRootDomainPrice
        );
    } else {
      return
        _getPrice(
          length,
          params.baseSubdomainLength,
          params.maxSubdomainPrice,
          params.maxSubdomainLength,
          params.minSubdomainPrice
        );
    }
  }

  /**
   * @notice Set the max price for root domains or subdomains. If this value or the
   * `priceMultiplier` value is `0` the price of any domain will also be `0`
   *
   * @param maxPrice The price to set in $ZERO
   * @param isRootDomain Flag for if the price is to be set for a root or subdomain
   */
  function setMaxPrice(
    uint256 maxPrice,
    bool isRootDomain
  ) external onlyAuthorized {
    if (isRootDomain) {
      params.maxRootDomainPrice = maxPrice;
    } else {
      params.maxSubdomainPrice = maxPrice;
    }

    emit BasePriceSet(maxPrice, isRootDomain);
  }

  // TODO function setMaxPrices(root, subdomains)

  /**
   * @notice In price calculation we use a `multiplier` to adjust how steep the
   * price curve is after the base price. This allows that value to be changed.
   * If this value or the `maxPrice` is `0` the price of any domain will also be `0`
   *
   * Valid values for the multiplier range are between 300 - 400 inclusively.
   * These are decimal values with two points of precision, meaning they are really 3.00 - 4.00
   * but we can't store them this way. We divide by 100 in the below internal price function
   * to make up for this.
   * @param multiplier The new price multiplier to set
   */
  function setPriceMultiplier(uint256 multiplier) external onlyAuthorized {
    require(
      multiplier >= 300 && multiplier <= 400,
      "ZNS: Multiplier out of range"
    );
    params.priceMultiplier = multiplier;

    emit PriceMultiplierSet(multiplier);
  }

  /**
   * @notice Set the value of the domain name length boundary where the default price applies
   * e.g. A value of '5' means all domains <= 5 in length cost the default price
   * @param length Boundary to set
   * @param isRootDomain Flag for if the price is to be set for a root or subdomain
   */
  function setBaseLength(
    uint256 length,
    bool isRootDomain
  ) external onlyAuthorized {
    if (isRootDomain) {
      params.baseRootDomainLength = length;
    } else {
      params.baseSubdomainLength = length;
    }

    emit BaseLengthSet(length, isRootDomain);
  }

  /**
   * @notice Set the value of both base lengt variables
   * @param rootLength The length for root domains
   * @param subdomainLength The length for subdomains
   */
  function setBaseLengths(
    uint256 rootLength,
    uint256 subdomainLength
  ) external onlyAuthorized {
    params.baseRootDomainLength = rootLength;
    params.baseSubdomainLength = subdomainLength;

    emit BaseLengthsSet(rootLength, subdomainLength);
  }

  /**
   * @notice Set the ZNSRegistrar for this contract
   * @param registrar The registrar to set
   */
  function setZNSRegistrar(address registrar) external onlyAuthorized {
    require(registrar != address(0), "ZNS: Zero address for Registrar");

    // Modify the access control for the new registrar
    authorized[znsRegistrar] = false;
    authorized[registrar] = true;
    znsRegistrar = registrar;

    emit ZNSRegistrarSet(registrar);
  }

  /**
   * @notice Return true if a user is authorized, otherwise false
   * @param user The user to check
   */
  function isAuthorized(address user) external view returns (bool) {
    return authorized[user];
  }

  /**
   * @notice Internal function to get price abstract of the base price being for
   * a root domain or a subdomain.
   *
   * @param length The length of the domain name
   * @param baseLength The base length to reach before we actually do the calculation
   * @param maxPrice The base price to calculate with
   * @param maxLength The maximum length of a name before turning the minimum price
   * @param minPrice The minimum price for that domain category
   */
  function _getPrice(
    uint256 length,
    uint256 baseLength,
    uint256 maxPrice,
    uint256 maxLength,
    uint256 minPrice
  ) internal view returns (uint256) {
    if (length <= baseLength) return maxPrice;
    if (length > maxLength) return minPrice;

    // Pull into memory to save external calls to storage
    uint256 multiplier = params.priceMultiplier;

    // TODO truncate to everything after the decimal, we don't want fractional prices
    // Should this be here vs. in the dApp?

    // This creates an asymptotic curve that decreases in pricing based on domain name length
    // Because there are no decimals in ETH we set the muliplier as 100x higher
    // than it is meant to be, so we divide by 100 to reverse that action here.
    // = (baseLength * maxPrice * multiplier)/(length + (3 * multiplier)
    return
      (baseLength * multiplier * maxPrice) /
      (length + (3 * multiplier)) /
      100;
  }
}
