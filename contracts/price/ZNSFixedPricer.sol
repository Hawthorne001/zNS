// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import { AAccessControlled } from "../access/AAccessControlled.sol";
import { ARegistryWired } from "../registry/ARegistryWired.sol";
import { IZNSFixedPricer } from "./IZNSFixedPricer.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";


contract ZNSFixedPricer is AAccessControlled, ARegistryWired, UUPSUpgradeable, IZNSFixedPricer {

    uint256 public constant PERCENTAGE_BASIS = 10000;

    mapping(bytes32 domainHash => PriceConfig config) public priceConfigs;

    function initialize(address _accessController, address _registry) external override initializer {
        _setAccessController(_accessController);
        setRegistry(_registry);
    }

    // TODO audit question: should we add onlyProxy modifiers for every function ??
    function setPrice(bytes32 domainHash, uint256 _price) public override onlyOwnerOrOperator(domainHash) {
        priceConfigs[domainHash].price = _price;

        emit PriceSet(domainHash, _price);
    }

    // solhint-disable-next-line no-unused-vars
    function getPrice(bytes32 parentHash, string calldata label) public override view returns (uint256) {
        return priceConfigs[parentHash].price;
    }

    function setFeePercentage(
        bytes32 domainHash,
        uint256 feePercentage
    ) public override onlyOwnerOrOperator(domainHash) {
        priceConfigs[domainHash].feePercentage = feePercentage;
        emit FeePercentageSet(domainHash, feePercentage);
    }

    function getFeeForPrice(
        bytes32 parentHash,
        uint256 price
    ) public view override returns (uint256) {
        return (price * priceConfigs[parentHash].feePercentage) / PERCENTAGE_BASIS;
    }

    function getPriceAndFee(
        bytes32 parentHash,
        string calldata label
    ) external view override returns (uint256 price, uint256 fee) {
        price = getPrice(parentHash, label);
        fee = getFeeForPrice(parentHash, price);
        return (price, fee);
    }

    function setPriceConfig(
        bytes32 domainHash,
        PriceConfig calldata priceConfig
    ) external override {
        setPrice(domainHash, priceConfig.price);
        setFeePercentage(domainHash, priceConfig.feePercentage);
    }

    function setRegistry(address registry_) public override(ARegistryWired, IZNSFixedPricer) onlyAdmin {
        _setRegistry(registry_);
    }

    /**
     * @notice To use UUPS proxy we override this function and revert if `msg.sender` isn't authorized
     * @param newImplementation The new implementation contract to upgrade to.
     */
    // solhint-disable-next-line
    function _authorizeUpgrade(address newImplementation) internal view override {
        accessController.checkGovernor(msg.sender);
    }
}
