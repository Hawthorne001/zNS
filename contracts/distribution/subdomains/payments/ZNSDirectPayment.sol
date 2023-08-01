// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import { AZNSPayment } from "../abstractions/AZNSPayment.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AccessControlled } from "../../../access/AccessControlled.sol";
import { IZNSRegistry } from "../../../registry/IZNSRegistry.sol";


contract ZNSDirectPayment is AccessControlled, AZNSPayment {
    using SafeERC20 for IERC20;

    event PaymentTokenChanged(bytes32 indexed domainHash, address newPaymentToken);
    event PaymentBeneficiaryChanged(bytes32 indexed domainHash, address newBeneficiary);
    event RegistrySet(address registry);

    struct PaymentConfig {
        IERC20 paymentToken;
        address beneficiary;
    }

    IZNSRegistry public registry;

    mapping(bytes32 domainHash => PaymentConfig config) internal paymentConfigs;

    modifier onlyOwnerOrOperator(bytes32 domainHash) {
        require(
            registry.isOwnerOrOperator(domainHash, msg.sender),
            "ZNSDirectPayment: Not authorized"
        );
        _;
    }

    constructor(address _accessController, address _registry) {
        _setAccessController(_accessController);
        setRegistry(_registry);
    }

    // TODO sub: add events !!
    function processPayment(
        bytes32 parentHash,
        bytes32 domainHash,
        address depositor,
        uint256 amount,
        // TODO sub: how do we handle fees ??
        uint256 fee
    ) external override onlyRegistrar {
        PaymentConfig memory config = paymentConfigs[parentHash];

        // setting paymentToken to 0x0 address means free domains
        // to save on tx costs, we avoid transfering 0
        if (address(config.paymentToken) != address(0)) {
            config.paymentToken.safeTransferFrom(
                depositor,
                config.beneficiary,
                amount
            );
        }
    }

    function getPaymentConfig(bytes32 domainHash) external view returns (PaymentConfig memory) {
        return paymentConfigs[domainHash];
    }

    // TODO sub: 2. is this the best way?
    function setPaymentConfig(
        bytes32 domainHash,
        PaymentConfig memory configToSet
    ) external onlyOwnerOrOperator(domainHash) {
        setPaymentToken(domainHash, configToSet.paymentToken);
        setPaymentBeneficiary(domainHash, configToSet.beneficiary);
    }

    // TODO sub: what about types here? should we do address instead?
    function setPaymentToken(bytes32 domainHash, IERC20 paymentToken) public onlyOwnerOrOperator(domainHash) {
        paymentConfigs[domainHash].paymentToken = paymentToken;

        emit PaymentTokenChanged(domainHash, address(paymentToken));
    }

    function setPaymentBeneficiary(bytes32 domainHash, address beneficiary) public onlyOwnerOrOperator(domainHash) {
        require(beneficiary != address(0), "ZNSDirectPayment: beneficiary cannot be 0x0 address");
        paymentConfigs[domainHash].beneficiary = beneficiary;

        emit PaymentBeneficiaryChanged(domainHash, beneficiary);
    }

    function setRegistry(address registry_) public onlyAdmin {
        require(registry_ != address(0), "ZNSDirectPayment: _registry can not be 0x0 address");
        registry = IZNSRegistry(registry_);

        emit RegistrySet(registry_);
    }

    function setAccessController(address accessController_)
    external
    override
    onlyAdmin {
        _setAccessController(accessController_);
    }

    function getAccessController() external view override returns (address) {
        return address(accessController);
    }
}
