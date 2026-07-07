import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { getAddress, type Address } from "viem";

import VenueStackModule from "../../ignition/modules/VenueStack.js";
import {
  BOUNDED_HOOK_PERMISSION_FLAGS,
  deployCompleteSetPostgradContracts,
  type PostgradVenueContracts,
} from "../../scripts/shared/deployment/deployCompleteSetPostgrad.js";
import {
  ensureDeterministicFactory,
  hasBytecode,
} from "../../scripts/shared/deployment/deterministicFactory.js";
import { VENUE_STACK_DEPLOYMENT } from "../../scripts/shared/deployment/venueStack.js";
import {
  configureOutcomePool,
  deployCompleteSetBinaryMarket,
} from "../../scripts/shared/market/deployCompleteSetMarketContracts.js";

const WAD = 10n ** 18n;
const HOOK_ADDRESS_FLAG_MASK = (1n << 14n) - 1n;

// The full deployment chain behind `just local-dev` (and `just
// local-deploy-venue` / `local-deploy-postgrad` /
// `local-create-complete-set-market`), run in-process against the real
// artifacts. A protocol change that breaks any deploy step fails here instead
// of at the next `just local-dev`. Steps share state, so the suite is ordered.
describe("complete-set venue deployment chain", async function () {
  const connection = await network.create();
  const { viem } = connection;
  const [deployer] = await viem.getWalletClients();
  const deployerAddress = getAddress(deployer.account.address);
  const publicClient = await viem.getPublicClient();

  let venueAddresses: {
    poolManager: Address;
    quoter: Address;
    stateView: Address;
    swapRouter: Address;
  };
  let postgrad: PostgradVenueContracts;

  it("deploys the venue stack Ignition module the venue deploy publishes", async function () {
    const deployed = (await connection.ignition.deploy(VenueStackModule)) as Record<
      string,
      { address: Address }
    >;

    // deploy-venue-stack.ts looks each descriptor's resultKey up in the
    // Ignition result; a missing key means the module and the manifest
    // descriptors drifted apart.
    for (const descriptor of VENUE_STACK_DEPLOYMENT.contracts) {
      const contract = deployed[descriptor.resultKey];
      assert.notEqual(contract, undefined, `Ignition result missing ${descriptor.resultKey}`);
      assert.equal(
        await hasBytecode(publicClient, contract.address),
        true,
        `${descriptor.contractName} has no bytecode`,
      );
    }

    venueAddresses = {
      poolManager: deployed.poolManager.address,
      quoter: deployed.quoter.address,
      stateView: deployed.stateView.address,
      swapRouter: deployed.swapRouter.address,
    };
  });

  it("keeps the manifest keys the local dev stack reads back", function () {
    // scripts/shared/deployments/readPostgradDeployment.ts (root workspace)
    // reads these venue manifest keys to wire the app and bot env.
    const manifestKeys: readonly string[] = VENUE_STACK_DEPLOYMENT.contracts.map(
      (descriptor) => descriptor.manifestKey,
    );

    for (const required of ["poolManager", "quoter", "stateView", "swapRouter"]) {
      assert.equal(manifestKeys.includes(required), true, `venue manifest lost ${required}`);
    }
  });

  it("seeds the deterministic CREATE2 factory on a local chain", async function () {
    await ensureDeterministicFactory({
      chainId: await publicClient.getChainId(),
      connection,
      factoryAddress: VENUE_STACK_DEPLOYMENT.deterministicFactoryAddress,
      publicClient,
    });

    assert.equal(
      await hasBytecode(publicClient, VENUE_STACK_DEPLOYMENT.deterministicFactoryAddress),
      true,
    );
  });

  it("deploys the postgrad venue contracts and wires the bounded hook", async function () {
    const pregradManager = await viem.deployContract("PregradManager");

    postgrad = await deployCompleteSetPostgradContracts({
      connection,
      deployerAddress,
      deterministicFactory: VENUE_STACK_DEPLOYMENT.deterministicFactoryAddress,
      outcomeDecimals: 18,
      poolManager: venueAddresses.poolManager,
      pregradManagerAddress: pregradManager.address,
      resolverAddress: deployerAddress,
      transferApproval: VENUE_STACK_DEPLOYMENT.transferApprovalAddress,
      walletClient: deployer,
    });

    for (const [name, address] of Object.entries({
      boundedHook: postgrad.boundedHookAddress,
      orderManager: postgrad.orderManagerAddress,
      poolTickBounds: postgrad.poolTickBoundsAddress,
      postgradAdapter: postgrad.postgradAdapterAddress,
    })) {
      assert.equal(await hasBytecode(publicClient, address), true, `${name} has no bytecode`);
    }

    // The CREATE2-mined hook address must encode exactly the beforeSwap and
    // afterSwap permission bits in its low 14 bits (v4-core Hooks.sol).
    assert.equal(
      BigInt(postgrad.boundedHookAddress) & HOOK_ADDRESS_FLAG_MASK,
      BOUNDED_HOOK_PERMISSION_FLAGS,
    );

    const hook = await viem.getContractAt("BoundedPredictionHook", postgrad.boundedHookAddress);
    assert.equal(await hook.read.hookPermissionFlags(), BOUNDED_HOOK_PERMISSION_FLAGS);

    const orderManager = await viem.getContractAt(
      "BoundedPoolOrderManager",
      postgrad.orderManagerAddress,
    );
    assert.equal(await orderManager.read.hookRole([postgrad.boundedHookAddress]), true);

    const adapter = await viem.getContractAt(
      "CompleteSetPostgradAdapter",
      postgrad.postgradAdapterAddress,
    );
    assert.equal(
      getAddress((await adapter.read.pregradManager()) as Address),
      getAddress(pregradManager.address),
    );
    assert.equal(getAddress((await adapter.read.resolver()) as Address), deployerAddress);
    assert.equal(await adapter.read.outcomeDecimals(), 18);
  });

  it("creates and configures a tradeable complete-set market on the venue", async function () {
    const collateral = await viem.deployContract("MockCollateral");
    const collateralDecimals = (await collateral.read.decimals()) as number;

    const market = await deployCompleteSetBinaryMarket({
      collateralAddress: collateral.address,
      connection,
      deployerAddress,
      marketName: "Deploy Chain Test Market",
      marketSymbol: "PCSM",
      ownerAddress: deployerAddress,
      resolverAddress: deployerAddress,
      walletClient: deployer,
    });

    assert.equal(await hasBytecode(publicClient, market.marketAddress), true);
    assert.notEqual(market.yesToken, market.noToken);

    const poolArgs = {
      collateral: { address: collateral.address, decimals: collateralDecimals },
      connection,
      orderManagerAddress: postgrad.orderManagerAddress,
      poolTickBoundsAddress: postgrad.poolTickBoundsAddress,
      venue: {
        boundedHook: postgrad.boundedHookAddress,
        poolManager: venueAddresses.poolManager,
        stateView: venueAddresses.stateView,
      },
      walletClient: deployer,
    } as const;
    const yesPool = await configureOutcomePool({
      ...poolArgs,
      openingDisplayPriceWad: WAD / 2n,
      outcomeToken: market.yesToken,
      side: "YES",
    });
    const noPool = await configureOutcomePool({
      ...poolArgs,
      openingDisplayPriceWad: WAD - WAD / 2n,
      outcomeToken: market.noToken,
      side: "NO",
    });

    for (const pool of [yesPool, noPool]) {
      assert.equal(getAddress(pool.poolKey.hooks), getAddress(postgrad.boundedHookAddress));
      assert.equal(pool.initialTick >= pool.boundLowerTick, true);
      assert.equal(pool.initialTick <= pool.boundUpperTick, true);
    }
    assert.notEqual(yesPool.poolId, noPool.poolId);

    const orderManager = await viem.getContractAt(
      "BoundedPoolOrderManager",
      postgrad.orderManagerAddress,
    );
    assert.equal(await orderManager.read.poolWhitelisted([yesPool.poolId]), true);
    assert.equal(await orderManager.read.poolWhitelisted([noPool.poolId]), true);
  });
});
