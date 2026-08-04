// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable use-natspec

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PregradManager} from "../../contracts/PregradManager.sol";
import {MarketTypes} from "../../contracts/types/MarketTypes.sol";
import {BaseTest} from "./BaseTest.sol";

/// Authorized market creation (repo ADR 0022 P4): EIP-712 authorizer
/// signature over the full params, unordered single-use nonce, expiry,
/// trusted-creator bypass, market born Active. The bare createMarket path is
/// deliberately untouched by the gate and keeps its own coverage in
/// PregradManager.t.sol until it retires.
contract PregradManagerCreationGateTest is BaseTest {
  // The test signs with a raw key so it exercises the contract's real
  // recovery path; these constants mirror the contract's typehashes, and the
  // happy-path test is what fails if either side's encodeType drifts.
  // solhint-disable max-line-length
  bytes32 private constant CREATE_MARKET_PARAMS_TYPEHASH = keccak256(
    "CreateMarketParams(address collateral,bytes32 metadataHash,string metadata,uint256 openingProbabilityWad,uint256 liquidityParameter,uint256 graduationThreshold,uint64 graduationDeadline,uint64 resolutionTime,uint64 yesNotBefore,bool bypassAiResolution)"
  );
  bytes32 private constant MARKET_CREATION_AUTHORIZATION_TYPEHASH = keccak256(
    "MarketCreationAuthorization(address creator,CreateMarketParams params,uint256 nonce,uint64 expiry)CreateMarketParams(address collateral,bytes32 metadataHash,string metadata,uint256 openingProbabilityWad,uint256 liquidityParameter,uint256 graduationThreshold,uint64 graduationDeadline,uint64 resolutionTime,uint64 yesNotBefore,bool bypassAiResolution)"
  );
  // solhint-enable max-line-length

  uint256 private constant AUTHORIZER_KEY = 0xA11CE;
  uint256 private constant MALLORY_KEY = 0xBADD1E;

  PregradManager private manager;
  address private authorizer;
  address private creator = makeAddr("creator");

  function setUp() public override {
    super.setUp();
    manager = _deployPregradManager();
    authorizer = vm.addr(AUTHORIZER_KEY);
    manager.setMarketCreationAuthorizer(authorizer);
    vm.deal(creator, 10e18);
  }

  function test_AuthorizedCreationBornActiveCollectsFeeAndSpendsNonce() public {
    MarketTypes.CreateMarketParams memory params = _params();
    MarketTypes.MarketCreationAuthorization memory authorization = _authorize(
      AUTHORIZER_KEY,
      creator,
      params,
      1,
      uint64(block.timestamp + 15 minutes)
    );

    // Hoisted before the prank: an external call inside the value expression
    // would consume the prank and the creation would run as the test contract.
    uint256 fee = manager.MARKET_CREATION_FEE();
    vm.prank(creator);
    uint256 marketId = manager.createMarket{value: fee}(params, authorization);

    assertEq(
      uint8(manager.getMarketState(marketId).status),
      uint8(MarketTypes.MarketStatus.Active),
      "authorized market must be born Active, with no on-chain review stop"
    );
    assertTrue(manager.isCreationAuthorizationNonceUsed(1));
    assertEq(manager.collectedCreationFees(), manager.MARKET_CREATION_FEE());
  }

  function test_BarePathStillBornUnderReview() public {
    // The interim contract carries both doors; the bare one keeps its exact
    // pre-gate behavior until publish switches over and it retires.
    uint256 marketId = manager.createMarket(_params());

    assertEq(
      uint8(manager.getMarketState(marketId).status),
      uint8(MarketTypes.MarketStatus.UnderReview)
    );
  }

  function test_RevertWhenAuthorizerUnset() public {
    manager.setMarketCreationAuthorizer(address(0));
    MarketTypes.CreateMarketParams memory params = _params();
    MarketTypes.MarketCreationAuthorization memory authorization = _authorize(
      AUTHORIZER_KEY,
      creator,
      params,
      1,
      uint64(block.timestamp + 15 minutes)
    );

    vm.prank(creator);
    vm.expectRevert(PregradManager.MarketCreationAuthorizerUnset.selector);
    manager.createMarket{value: 1e18}(params, authorization);
  }

  function test_RevertWhenExpired() public {
    MarketTypes.CreateMarketParams memory params = _params();
    uint64 expiry = uint64(block.timestamp + 15 minutes);
    MarketTypes.MarketCreationAuthorization memory authorization = _authorize(
      AUTHORIZER_KEY,
      creator,
      params,
      1,
      expiry
    );

    vm.warp(expiry + 1);
    vm.prank(creator);
    vm.expectRevert(
      abi.encodeWithSelector(PregradManager.MarketCreationAuthorizationExpired.selector, expiry)
    );
    manager.createMarket{value: 1e18}(params, authorization);
  }

  function test_RevertWhenNonceReused() public {
    MarketTypes.CreateMarketParams memory params = _params();
    uint64 expiry = uint64(block.timestamp + 15 minutes);
    vm.prank(creator);
    manager.createMarket{value: 1e18}(
      params,
      _authorize(AUTHORIZER_KEY, creator, params, 7, expiry)
    );

    // A fresh authorization over different params still cannot ride a spent
    // nonce: single-use is a property of the nonce, not of the params.
    MarketTypes.CreateMarketParams memory second = _params();
    second.metadata = "second-market-metadata";
    second.metadataHash = keccak256(bytes(second.metadata));

    vm.prank(creator);
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.MarketCreationAuthorizationNonceUsed.selector,
        uint256(7)
      )
    );
    manager.createMarket{value: 1e18}(
      second,
      _authorize(AUTHORIZER_KEY, creator, second, 7, expiry)
    );
  }

  function test_UnusedNoncesSpendInAnyOrder() public {
    // Unordered on purpose (ADR 0022 P4 decisions): a creator with several
    // approved drafts publishes them in whatever order lands, so a high nonce
    // must not block a lower one.
    MarketTypes.CreateMarketParams memory params = _params();
    uint64 expiry = uint64(block.timestamp + 15 minutes);

    vm.prank(creator);
    manager.createMarket{value: 1e18}(
      params,
      _authorize(AUTHORIZER_KEY, creator, params, 1_000, expiry)
    );
    vm.prank(creator);
    manager.createMarket{value: 1e18}(
      params,
      _authorize(AUTHORIZER_KEY, creator, params, 2, expiry)
    );

    assertTrue(manager.isCreationAuthorizationNonceUsed(1_000));
    assertTrue(manager.isCreationAuthorizationNonceUsed(2));
  }

  function test_RevertWhenSignedByNonAuthorizer() public {
    MarketTypes.CreateMarketParams memory params = _params();
    MarketTypes.MarketCreationAuthorization memory authorization = _authorize(
      MALLORY_KEY,
      creator,
      params,
      1,
      uint64(block.timestamp + 15 minutes)
    );

    vm.prank(creator);
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.InvalidMarketCreationAuthorization.selector,
        vm.addr(MALLORY_KEY)
      )
    );
    manager.createMarket{value: 1e18}(params, authorization);
  }

  function test_RevertWhenParamsTampered() public {
    // Signed for the reviewed params, submitted with a different liquidity
    // parameter: the signature covers every economic field, so the recovered
    // signer is garbage and the call reverts.
    MarketTypes.CreateMarketParams memory reviewed = _params();
    MarketTypes.MarketCreationAuthorization memory authorization = _authorize(
      AUTHORIZER_KEY,
      creator,
      reviewed,
      1,
      uint64(block.timestamp + 15 minutes)
    );

    MarketTypes.CreateMarketParams memory tampered = reviewed;
    tampered.liquidityParameter = reviewed.liquidityParameter * 2;

    vm.prank(creator);
    vm.expectRevert();
    manager.createMarket{value: 1e18}(tampered, authorization);
  }

  function test_RevertWhenSentByDifferentCreator() public {
    // The authorization binds the creator, so a leaked signature is inert
    // from any other wallet.
    MarketTypes.CreateMarketParams memory params = _params();
    MarketTypes.MarketCreationAuthorization memory authorization = _authorize(
      AUTHORIZER_KEY,
      creator,
      params,
      1,
      uint64(block.timestamp + 15 minutes)
    );

    address thief = makeAddr("thief");
    vm.deal(thief, 1e18);
    vm.prank(thief);
    vm.expectRevert();
    manager.createMarket{value: 1e18}(params, authorization);
  }

  function test_TrustedCreatorSkipsSignatureAndFeeBornActive() public {
    // address(this) is trusted by the BaseTest deploy helper. Zeroed
    // authorization, no fee, still born Active — the vetted-party path.
    MarketTypes.MarketCreationAuthorization memory zeroed;

    uint256 marketId = manager.createMarket(_params(), zeroed);

    assertEq(
      uint8(manager.getMarketState(marketId).status),
      uint8(MarketTypes.MarketStatus.Active)
    );
  }

  function test_SetAuthorizerIsOwnerOnlyAndEmits() public {
    address next = makeAddr("next-authorizer");

    vm.expectEmit(true, true, true, true, address(manager));
    emit PregradManager.MarketCreationAuthorizerUpdated(authorizer, next);
    manager.setMarketCreationAuthorizer(next);
    assertEq(manager.marketCreationAuthorizer(), next);

    address rando = makeAddr("rando");
    vm.prank(rando);
    vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rando));
    manager.setMarketCreationAuthorizer(address(0));
  }

  function _params() private view returns (MarketTypes.CreateMarketParams memory) {
    return
      MarketTypes.CreateMarketParams({
        collateral: address(collateral),
        metadataHash: keccak256(bytes("gate-market-metadata")),
        metadata: "gate-market-metadata",
        openingProbabilityWad: (50 * WAD) / 100,
        liquidityParameter: 5_000 * WAD,
        graduationThreshold: 2_500 * WAD,
        graduationDeadline: uint64(block.timestamp + 7 days),
        resolutionTime: uint64(block.timestamp + 14 days),
        yesNotBefore: uint64(block.timestamp + 14 days),
        bypassAiResolution: false
      });
  }

  function _authorize(
    uint256 signerKey,
    address boundCreator,
    MarketTypes.CreateMarketParams memory params,
    uint256 nonce,
    uint64 expiry
  ) private view returns (MarketTypes.MarketCreationAuthorization memory) {
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
        _hashParams(params),
        nonce,
        expiry
      )
    );
    bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);

    return
      MarketTypes.MarketCreationAuthorization({
        nonce: nonce,
        expiry: expiry,
        signature: abi.encodePacked(r, s, v)
      });
  }

  function _hashParams(
    MarketTypes.CreateMarketParams memory params
  ) private pure returns (bytes32) {
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
}
