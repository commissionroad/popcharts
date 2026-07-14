// Hermetic unit-suite environment (ADR 0017 Track B). Registered as a bun
// test preload, so it runs before any module — including src/config, whose
// exports are cached at first import — can capture ambient endpoints. No
// unit test may reach a real network: 127.0.0.1:1 refuses instantly.
//
// Venue/manager addresses are set (to dummies) so code paths gated on
// "venue configured" run and then fail at the dead RPC, deterministically —
// the degraded/unreachable branches, not the unconfigured ones.
//
// arcTestnet rather than local: the local network enables dev-only
// behaviors (e.g. the Markets API verifies local markets on-chain and
// drops them when the RPC is unreachable) that would make DB-seeded route
// tests assert on chain state instead of the API contract.
process.env.NETWORK = "arcTestnet";
process.env.RPC_HTTP_URL = "http://127.0.0.1:1";
process.env.RPC_WSS_URL = "ws://127.0.0.1:1";
process.env.LOCAL_RPC_HTTP_URL = "http://127.0.0.1:1";
process.env.LOCAL_RPC_WSS_URL = "ws://127.0.0.1:1";
process.env.ARC_TESTNET_RPC_HTTP_URL = "http://127.0.0.1:1";
process.env.ARC_TESTNET_RPC_WSS_URL = "ws://127.0.0.1:1";
process.env.BOUNDED_HOOK_ADDRESS = "0x0000000000000000000000000000000000000101";
process.env.ORDER_MANAGER_ADDRESS =
  "0x0000000000000000000000000000000000000102";
process.env.POOL_MANAGER_ADDRESS = "0x0000000000000000000000000000000000000103";
process.env.POOL_TICK_BOUNDS_ADDRESS =
  "0x0000000000000000000000000000000000000104";
process.env.STATE_VIEW_ADDRESS = "0x0000000000000000000000000000000000000105";
process.env.PREGRAD_MANAGER_ADDRESS =
  "0x0000000000000000000000000000000000000106";
process.env.POSTGRAD_ADAPTER_ADDRESS =
  "0x0000000000000000000000000000000000000107";
process.env.SWAP_ROUTER_ADDRESS = "0x0000000000000000000000000000000000000108";
