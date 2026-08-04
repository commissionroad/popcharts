// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable use-natspec

import {Test} from "forge-std/Test.sol";
import {MockCollateral} from "../../contracts/mocks/MockCollateral.sol";
import {MarketTypes} from "../../contracts/types/MarketTypes.sol";
import {PregradManager} from "../../contracts/PregradManager.sol";

/// Shared fixtures for the Solidity test suites that exercise the pregrad and
/// postgrad market contracts against the 18-decimal mock collateral. Suites
/// with bespoke environments (the v4 venue stack pinned to solc 0.8.26 and the
/// pure-library harness tests) intentionally do not inherit from this.
abstract contract BaseTest is Test {
  uint256 internal constant WAD = 1e18;

  /// Key the test suites arm as the market-creation authorizer.
  uint256 internal constant AUTHORIZER_KEY = 0xA11CE;

  // Mirrors of the contract's EIP-712 typehashes; the gate suite's happy path
  // is what fails if either side's encodeType drifts.
  // solhint-disable max-line-length
  bytes32 internal constant CREATE_MARKET_PARAMS_TYPEHASH = keccak256(
    "CreateMarketParams(address collateral,bytes32 metadataHash,string metadata,uint256 openingProbabilityWad,uint256 liquidityParameter,uint256 graduationThreshold,uint64 graduationDeadline,uint64 resolutionTime,uint64 yesNotBefore,bool bypassAiResolution)"
  );
  bytes32 internal constant MARKET_CREATION_AUTHORIZATION_TYPEHASH = keccak256(
    "MarketCreationAuthorization(address creator,CreateMarketParams params,uint256 nonce,uint64 expiry)CreateMarketParams(address collateral,bytes32 metadataHash,string metadata,uint256 openingProbabilityWad,uint256 liquidityParameter,uint256 graduationThreshold,uint64 graduationDeadline,uint64 resolutionTime,uint64 yesNotBefore,bool bypassAiResolution)"
  );
  // solhint-enable max-line-length

  uint256 private _nextAuthorizationNonce = 1;

  MockCollateral internal collateral;

  function setUp() public virtual {
    collateral = new MockCollateral();
  }

  /// Deploys a PregradManager owned by the test contract with the test
  /// contract registered as a trusted creator.
  function _deployPregradManager() internal returns (PregradManager manager) {
    manager = new PregradManager();
    manager.setTrustedCreator(address(this), true);
    manager.setMarketCreationAuthorizer(vm.addr(AUTHORIZER_KEY));
  }

  /// Spendable only by trusted creators: skips verification entirely.
  function _zeroedAuthorization()
    internal
    pure
    returns (MarketTypes.MarketCreationAuthorization memory)
  {
    return MarketTypes.MarketCreationAuthorization({nonce: 0, expiry: 0, signature: ""});
  }

  /// Signs a real creation authorization for `boundCreator` over `params`,
  /// with a fresh nonce and a 15-minute expiry.
  function _authorizeCreation(
    PregradManager manager,
    address boundCreator,
    MarketTypes.CreateMarketParams memory params
  ) internal returns (MarketTypes.MarketCreationAuthorization memory) {
    uint256 nonce = _nextAuthorizationNonce++;
    uint64 expiry = uint64(block.timestamp + 15 minutes);
    bytes32 domainSeparator = keccak256(
      abi.encode(
        keccak256(
          "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        ),
        keccak256("PregradManager"),
        keccak256("1"),
        block.chainid,
        address(manager)
      )
    );
    bytes32 structHash = keccak256(
      abi.encode(
        MARKET_CREATION_AUTHORIZATION_TYPEHASH,
        boundCreator,
        _hashCreateMarketParams(params),
        nonce,
        expiry
      )
    );
    bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(AUTHORIZER_KEY, digest);

    return
      MarketTypes.MarketCreationAuthorization({
        nonce: nonce,
        expiry: expiry,
        signature: abi.encodePacked(r, s, v)
      });
  }

  function _hashCreateMarketParams(
    MarketTypes.CreateMarketParams memory params
  ) internal pure returns (bytes32) {
    return
      keccak256(
        abi.encode(
          CREATE_MARKET_PARAMS_TYPEHASH,
          params.collateral,
          params.metadataHash,
          keccak256(bytes(params.metadata)),
          params.openingProbabilityWad,
          params.liquidityParameter,
          params.graduationThreshold,
          params.graduationDeadline,
          params.resolutionTime,
          params.yesNotBefore,
          params.bypassAiResolution
        )
      );
  }

  /// Mints `mintAmount` of the shared mock collateral to `account` and lets
  /// `spender` pull up to `approveAmount` of it.
  function _fundAndApprove(
    address account,
    address spender,
    uint256 mintAmount,
    uint256 approveAmount
  ) internal {
    collateral.mint(account, mintAmount);
    vm.prank(account);
    collateral.approve(spender, approveAmount);
  }
}
