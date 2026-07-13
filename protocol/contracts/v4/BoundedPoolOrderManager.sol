// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

// solhint-disable immutable-vars-naming

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IUnlockCallback} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IPoolManager} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-periphery/lib/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-periphery/lib/v4-core/src/libraries/TickMath.sol";
import {BalanceDelta} from "@uniswap/v4-periphery/lib/v4-core/src/types/BalanceDelta.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-periphery/lib/v4-core/src/types/Currency.sol";
import {PoolId} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolOperation.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IBoundedPoolOrderManager} from "./interfaces/IBoundedPoolOrderManager.sol";
import {OrderBook} from "./libraries/OrderBook.sol";
import {OrderValidation} from "./libraries/OrderValidation.sol";
import {PackedOrderId, PackedOrderIdLibrary} from "./libraries/PackedOrderId.sol";
import {ITokenPuller, V4DeltaSettlement} from "./libraries/V4DeltaSettlement.sol";

/// @title BoundedPoolOrderManager
/// @author Pop Charts
/// @notice Full-fill and deferred-execution order manager for bounded ERC20 prediction pools.
contract BoundedPoolOrderManager is Ownable, IUnlockCallback, IBoundedPoolOrderManager {
  using CurrencyLibrary for Currency;
  using OrderBook for OrderBook.Book;
  using PackedOrderIdLibrary for PackedOrderId;
  using StateLibrary for IPoolManager;

  /// @notice Maker order represented as one-sided v4 pool liquidity.
  /// @param owner Account that owns the order.
  /// @param zeroForOne Whether the maker is selling currency0 for currency1.
  /// @param tickLower Lower tick of the liquidity range.
  /// @param tickUpper Upper tick of the liquidity range.
  /// @param indexedTick Tick where the order is currently indexed for execution.
  /// @param liquidity Pool liquidity added by the order.
  /// @param enablePartialFill Whether crossed movement may partially fill the order.
  struct Order {
    address owner;
    bool zeroForOne;
    int24 tickLower;
    int24 tickUpper;
    int24 indexedTick;
    uint128 liquidity;
    bool enablePartialFill;
  }

  /// @notice Deferred crossed-order batch awaiting resolver execution.
  /// @param pending Whether the batch is still waiting for resolver work.
  /// @param key Pool key for the deferred batch.
  /// @param fromTick Pool tick observed before the original movement.
  /// @param toTick Pool tick observed after the original movement.
  /// @param sqrtPriceX96 Pool square-root price after the original movement.
  /// @param nextOrderIndex Next deferred order index to process.
  /// @param orderIds Crossed order IDs not processed in the immediate batch.
  struct DeferredExecution {
    bool pending;
    PoolKey key;
    int24 fromTick;
    int24 toTick;
    uint160 sqrtPriceX96;
    uint256 nextOrderIndex;
    PackedOrderId[] orderIds;
  }

  /// @notice Parameters for creating one maker order.
  /// @param key Pool where liquidity should be placed.
  /// @param zeroForOne Whether the maker is selling currency0 for currency1.
  /// @param tickLower Lower tick of the liquidity range.
  /// @param tickUpper Upper tick of the liquidity range.
  /// @param amountInMaximum Maximum input token amount the maker is willing to deposit.
  /// @param enablePartialFill Whether crossed movement may partially fill the order.
  /// @param hookData Hook data forwarded to the pool manager.
  struct CreateOrderParams {
    PoolKey key;
    bool zeroForOne;
    int24 tickLower;
    int24 tickUpper;
    uint256 amountInMaximum;
    bool enablePartialFill;
    bytes hookData;
  }

  enum UnlockAction {
    CreateOrder,
    CancelOrder,
    ResolveDeferredExecution
  }

  struct CreateOrderCallbackData {
    address owner;
    PoolKey key;
    bool zeroForOne;
    int24 tickLower;
    int24 tickUpper;
    uint128 liquidity;
    uint256 amountInMaximum;
    bytes32 salt;
    bytes hookData;
  }

  struct CancelOrderCallbackData {
    address owner;
    PoolKey key;
    Order order;
    bytes32 salt;
    bytes hookData;
  }

  struct ResolveDeferredExecutionCallbackData {
    bytes32 executionId;
    uint256 requestedExecutionCount;
  }

  struct PartialExecutionResult {
    int24 tickLower;
    int24 tickUpper;
    int24 indexedTick;
    uint128 remainingLiquidity;
    uint256 amount0;
    uint256 amount1;
  }

  /// @notice Reverts when the pool manager address is zero.
  error InvalidPoolManager();
  /// @notice Reverts when the token-puller address is zero.
  error InvalidTokenPuller();
  /// @notice Reverts when an amount is zero.
  error InvalidAmount();
  /// @notice Reverts when an execution-count configuration is zero.
  error InvalidExecutionCount();
  /// @notice Reverts when computed liquidity is zero.
  error InvalidLiquidity();
  /// @notice Reverts when a pool has not been whitelisted.
  /// @param poolId Pool that is not whitelisted.
  error PoolNotWhitelisted(PoolId poolId);
  /// @notice Reverts when a pool's hook has not been authorized.
  /// @param hook Unauthorized hook address.
  error PoolHookUnauthorized(address hook);
  /// @notice Reverts when a hook-only function is called by an unauthorized account.
  /// @param caller Unauthorized caller.
  error UnauthorizedHook(address caller);
  /// @notice Reverts when a resolver-only function is called by an unauthorized account.
  /// @param caller Unauthorized caller.
  error UnauthorizedResolver(address caller);
  /// @notice Reverts when an order is absent.
  /// @param poolId Pool that should contain the order.
  /// @param orderId Missing per-pool order ID.
  error OrderNotFound(PoolId poolId, uint32 orderId);
  /// @notice Reverts when a deferred execution ID is absent.
  /// @param executionId Missing deferred execution ID.
  error DeferredExecutionNotFound(bytes32 executionId);
  /// @notice Reverts when an account other than the maker attempts to cancel.
  /// @param caller Account attempting cancellation.
  /// @param owner Order owner.
  error UnauthorizedOrderOwner(address caller, address owner);
  /// @notice Reverts when a pool manager callback comes from the wrong caller.
  error UnauthorizedUnlockCallback();
  /// @notice Reverts when an unknown unlock action is decoded.
  /// @param action Unknown action discriminator.
  error UnsupportedUnlockAction(uint8 action);

  /// @notice Emitted when a pool whitelist flag changes.
  /// @param poolId Pool whose flag changed.
  /// @param whitelisted Whether the pool is whitelisted.
  event PoolWhitelistSet(PoolId indexed poolId, bool whitelisted);
  /// @notice Emitted when a hook role changes.
  /// @param hook Hook address.
  /// @param allowed Whether the hook may execute crossed orders.
  event HookRoleSet(address indexed hook, bool allowed);
  /// @notice Emitted when a resolver role changes.
  /// @param resolver Resolver address.
  /// @param allowed Whether the resolver may process deferred batches.
  event ResolverRoleSet(address indexed resolver, bool allowed);
  /// @notice Emitted when the immediate execution cap changes.
  /// @param maximumExecutionCount Maximum crossed order IDs to process immediately.
  event MaximumExecutionCountSet(uint256 maximumExecutionCount);
  /// @notice Emitted when a token minimum changes.
  /// @param token ERC20 token address.
  /// @param minimumAmount Minimum maker input amount.
  event MinimumOrderAmountSet(address indexed token, uint256 minimumAmount);
  /// @notice Emitted when a maker order is created.
  /// @param poolId Pool containing the order.
  /// @param orderId Per-pool order ID.
  /// @param owner Maker that owns the order.
  /// @param zeroForOne Whether the maker is selling currency0 for currency1.
  /// @param tickLower Lower tick of the liquidity range.
  /// @param tickUpper Upper tick of the liquidity range.
  /// @param liquidity Pool liquidity added by the order.
  /// @param amountIn Input token amount consumed by the order.
  event OrderCreated(
    PoolId indexed poolId,
    uint32 indexed orderId,
    address indexed owner,
    bool zeroForOne,
    int24 tickLower,
    int24 tickUpper,
    uint128 liquidity,
    uint256 amountIn
  );
  /// @notice Emitted when an order is cancelled and remaining inventory is returned.
  /// @param poolId Pool containing the order.
  /// @param orderId Per-pool order ID.
  /// @param owner Maker that owned the order.
  /// @param amount0 Currency0 amount returned.
  /// @param amount1 Currency1 amount returned.
  event OrderCancelled(
    PoolId indexed poolId,
    uint32 indexed orderId,
    address indexed owner,
    uint256 amount0,
    uint256 amount1
  );
  /// @notice Emitted when an order fully fills after its threshold is crossed.
  /// @param poolId Pool containing the order.
  /// @param orderId Per-pool order ID.
  /// @param owner Maker that owned the order.
  /// @param amount0 Currency0 amount paid to the maker.
  /// @param amount1 Currency1 amount paid to the maker.
  event OrderFilled(
    PoolId indexed poolId,
    uint32 indexed orderId,
    address indexed owner,
    uint256 amount0,
    uint256 amount1
  );
  /// @notice Emitted when an order partially fills and remaining liquidity is reindexed.
  /// @param poolId Pool containing the order.
  /// @param orderId Per-pool order ID.
  /// @param owner Maker that owns the order.
  /// @param amount0 Currency0 amount paid to the maker.
  /// @param amount1 Currency1 amount paid to the maker.
  /// @param tickLower Updated lower tick for the remaining order.
  /// @param tickUpper Updated upper tick for the remaining order.
  /// @param indexedTick Updated execution index tick for the remaining order.
  /// @param remainingLiquidity Remaining pool liquidity after the partial fill.
  event OrderPartiallyFilled(
    PoolId indexed poolId,
    uint32 indexed orderId,
    address indexed owner,
    uint256 amount0,
    uint256 amount1,
    int24 tickLower,
    int24 tickUpper,
    int24 indexedTick,
    uint128 remainingLiquidity
  );
  /// @notice Emitted when a popped order is kept because movement did not fully cross it.
  /// @param poolId Pool containing the order.
  /// @param orderId Per-pool order ID.
  /// @param thresholdTick Tick where the order remains indexed.
  event OrderRequeued(PoolId indexed poolId, uint32 indexed orderId, int24 thresholdTick);
  /// @notice Emitted when crossed orders are deferred for resolver work.
  /// @param executionId Deferred execution ID.
  /// @param poolId Pool containing the deferred orders.
  /// @param fromTick Pool tick before the original movement.
  /// @param toTick Pool tick after the original movement.
  /// @param orderCount Number of order IDs stored for resolver work.
  event DeferredExecutionStored(
    bytes32 indexed executionId,
    PoolId indexed poolId,
    int24 fromTick,
    int24 toTick,
    uint256 orderCount
  );
  /// @notice Emitted when a resolver processes a deferred execution batch.
  /// @param executionId Deferred execution ID.
  /// @param poolId Pool containing the deferred orders.
  /// @param processedCount Number of order IDs consumed by this resolver call.
  /// @param complete Whether the deferred execution ID is fully resolved.
  event DeferredExecutionResolved(
    bytes32 indexed executionId,
    PoolId indexed poolId,
    uint256 processedCount,
    bool complete
  );

  /// @notice Pool manager used for all liquidity operations.
  IPoolManager public immutable poolManager;
  /// @notice External allowance-transfer contract used to pull maker input tokens.
  ITokenPuller public immutable tokenPuller;

  /// @notice Whether a pool may receive maker orders.
  mapping(PoolId => bool) public poolWhitelisted;
  /// @notice Whether an address may execute crossed orders.
  mapping(address => bool) public hookRole;
  /// @notice Whether an address may resolve deferred execution batches.
  mapping(address => bool) public resolverRole;
  /// @notice Minimum maker input amount by ERC20 token.
  mapping(address => uint256) public minimumOrderAmount;
  /// @notice Maximum crossed order IDs processed by one immediate or resolver batch.
  uint256 public maximumExecutionCount;

  mapping(PoolId => OrderBook.Book) private _orderBooks;
  mapping(PoolId => mapping(uint32 => Order)) private _orders;
  mapping(bytes32 => DeferredExecution) private _deferredExecutions;

  uint256 private _deferredExecutionNonce;

  /// @notice Records the pool manager, token-puller, and owner.
  /// @param poolManager_ v4 pool manager.
  /// @param tokenPuller_ Allowance-transfer contract for maker token pulls.
  /// @param owner_ Administrative owner for whitelist and hook-role management.
  constructor(
    IPoolManager poolManager_,
    ITokenPuller tokenPuller_,
    address owner_
  ) Ownable(owner_) {
    if (address(poolManager_) == address(0)) {
      revert InvalidPoolManager();
    }
    if (address(tokenPuller_) == address(0)) {
      revert InvalidTokenPuller();
    }

    poolManager = poolManager_;
    tokenPuller = tokenPuller_;
    maximumExecutionCount = type(uint256).max;
  }

  /// @notice Sets whether a pool can receive maker orders.
  /// @param key Pool key.
  /// @param whitelisted Whether the pool is allowed.
  function setPoolWhitelisted(PoolKey calldata key, bool whitelisted) external onlyOwner {
    PoolId poolId = key.toId();
    poolWhitelisted[poolId] = whitelisted;
    emit PoolWhitelistSet(poolId, whitelisted);
  }

  /// @notice Sets whether a hook may execute crossed orders.
  /// @param hook Hook address.
  /// @param allowed Whether the hook may execute crossed orders.
  function setHookRole(address hook, bool allowed) external onlyOwner {
    hookRole[hook] = allowed;
    emit HookRoleSet(hook, allowed);
  }

  /// @notice Sets whether an address may resolve deferred execution batches.
  /// @param resolver Resolver address.
  /// @param allowed Whether the resolver may process deferred batches.
  function setResolverRole(address resolver, bool allowed) external onlyOwner {
    resolverRole[resolver] = allowed;
    emit ResolverRoleSet(resolver, allowed);
  }

  /// @notice Sets the maximum crossed order IDs processed by one execution batch.
  /// @param maximumExecutionCount_ Maximum crossed order IDs per batch.
  function setMaximumExecutionCount(uint256 maximumExecutionCount_) external onlyOwner {
    if (maximumExecutionCount_ == 0) {
      revert InvalidExecutionCount();
    }

    maximumExecutionCount = maximumExecutionCount_;
    emit MaximumExecutionCountSet(maximumExecutionCount_);
  }

  /// @notice Sets the minimum maker input amount for a token.
  /// @param token ERC20 token address.
  /// @param amount Minimum order amount.
  function setMinimumOrderAmount(address token, uint256 amount) external onlyOwner {
    minimumOrderAmount[token] = amount;
    emit MinimumOrderAmountSet(token, amount);
  }

  /// @notice Creates a one-sided pool-liquidity maker order.
  /// @param params Order creation parameters.
  /// @return orderId Per-pool order ID.
  /// @return liquidity Pool liquidity added by the order.
  /// @return amountIn Input token amount consumed by the order.
  function createOrder(
    CreateOrderParams calldata params
  ) external returns (uint32 orderId, uint128 liquidity, uint256 amountIn) {
    PoolId poolId = params.key.toId();
    _validateCreateOrder(params, poolId);

    liquidity = _liquidityForAmount(
      params.zeroForOne,
      params.tickLower,
      params.tickUpper,
      params.amountInMaximum
    );
    if (liquidity == 0) {
      revert InvalidLiquidity();
    }

    orderId = _orderBooks[poolId].allocateOrderId();
    amountIn = _addOrderLiquidity(params, orderId, liquidity);
    _storeCreatedOrder(params, poolId, orderId, liquidity, amountIn);
  }

  function _validateCreateOrder(CreateOrderParams calldata params, PoolId poolId) private view {
    _validatePoolForOrders(poolId, params.key);
    if (params.amountInMaximum == 0) {
      revert InvalidAmount();
    }

    Currency inputCurrency = params.zeroForOne ? params.key.currency0 : params.key.currency1;
    uint256 minimumAmount = minimumOrderAmount[Currency.unwrap(inputCurrency)];
    if (params.amountInMaximum < minimumAmount) {
      revert InvalidAmount();
    }

    (, int24 currentTick, , ) = poolManager.getSlot0(poolId);
    OrderValidation.validateTickRange(params.tickLower, params.tickUpper, params.key.tickSpacing);
    OrderValidation.validateOneSidedOrder(
      params.zeroForOne,
      currentTick,
      params.tickLower,
      params.tickUpper
    );
  }

  function _addOrderLiquidity(
    CreateOrderParams calldata params,
    uint32 orderId,
    uint128 liquidity
  ) private returns (uint256 amountIn) {
    bytes memory result = poolManager.unlock(
      abi.encode(
        UnlockAction.CreateOrder,
        abi.encode(
          CreateOrderCallbackData({
            owner: msg.sender,
            key: params.key,
            zeroForOne: params.zeroForOne,
            tickLower: params.tickLower,
            tickUpper: params.tickUpper,
            liquidity: liquidity,
            amountInMaximum: params.amountInMaximum,
            salt: _positionSalt(orderId),
            hookData: params.hookData
          })
        )
      )
    );

    return abi.decode(result, (uint256));
  }

  function _storeCreatedOrder(
    CreateOrderParams calldata params,
    PoolId poolId,
    uint32 orderId,
    uint128 liquidity,
    uint256 amountIn
  ) private {
    int24 indexedTick = _initialIndexedTick(
      params.zeroForOne,
      params.tickLower,
      params.tickUpper,
      params.enablePartialFill
    );
    _orders[poolId][orderId] = Order({
      owner: msg.sender,
      zeroForOne: params.zeroForOne,
      tickLower: params.tickLower,
      tickUpper: params.tickUpper,
      indexedTick: indexedTick,
      liquidity: liquidity,
      enablePartialFill: params.enablePartialFill
    });

    _orderBooks[poolId].insert(indexedTick, PackedOrderIdLibrary.pack(orderId));

    emit OrderCreated(
      poolId,
      orderId,
      msg.sender,
      params.zeroForOne,
      params.tickLower,
      params.tickUpper,
      liquidity,
      amountIn
    );
  }

  /// @notice Cancels an active order and returns its remaining inventory to the maker.
  /// @param key Pool key.
  /// @param orderId Per-pool order ID.
  /// @param hookData Hook data forwarded to the pool manager.
  /// @return amount0 Currency0 amount returned.
  /// @return amount1 Currency1 amount returned.
  function cancelOrder(
    PoolKey calldata key,
    uint32 orderId,
    bytes calldata hookData
  ) external returns (uint256 amount0, uint256 amount1) {
    PoolId poolId = key.toId();
    Order memory order = _requireOrder(poolId, orderId);
    if (msg.sender != order.owner) {
      revert UnauthorizedOrderOwner(msg.sender, order.owner);
    }

    _orderBooks[poolId].remove(order.indexedTick, PackedOrderIdLibrary.pack(orderId));

    bytes memory result = poolManager.unlock(
      abi.encode(
        UnlockAction.CancelOrder,
        abi.encode(
          CancelOrderCallbackData({
            owner: order.owner,
            key: key,
            order: order,
            salt: _positionSalt(orderId),
            hookData: hookData
          })
        )
      )
    );

    (amount0, amount1) = abi.decode(result, (uint256, uint256));
    delete _orders[poolId][orderId];

    emit OrderCancelled(poolId, orderId, order.owner, amount0, amount1);
  }

  /// @inheritdoc IBoundedPoolOrderManager
  function movePoolTick(
    PoolKey calldata key,
    int24 fromTick,
    int24 toTick,
    uint160 sqrtPriceX96
  ) external {
    if (!hookRole[msg.sender]) {
      revert UnauthorizedHook(msg.sender);
    }

    PoolId poolId = key.toId();
    if (!poolWhitelisted[poolId]) {
      return;
    }

    PackedOrderId[] memory crossedOrderIds = _orderBooks[poolId].popCrossedOrderIds(
      fromTick,
      toTick,
      key.tickSpacing
    );

    uint256 processedCount = _processOrderIds(
      key,
      poolId,
      fromTick,
      toTick,
      crossedOrderIds,
      maximumExecutionCount
    );
    if (processedCount < crossedOrderIds.length) {
      _storeDeferredExecution(
        key,
        poolId,
        fromTick,
        toTick,
        sqrtPriceX96,
        crossedOrderIds,
        processedCount
      );
    }
  }

  /// @notice Processes a deferred crossed-order batch.
  /// @param executionId Deferred execution ID.
  /// @param requestedExecutionCount Optional lower per-call cap; zero uses `maximumExecutionCount`.
  /// @return processedCount Number of order IDs consumed by this resolver call.
  /// @return complete Whether the deferred execution ID is fully resolved.
  function resolveDeferredExecution(
    bytes32 executionId,
    uint256 requestedExecutionCount
  ) external returns (uint256 processedCount, bool complete) {
    if (msg.sender != owner() && !resolverRole[msg.sender]) {
      revert UnauthorizedResolver(msg.sender);
    }
    if (!_deferredExecutions[executionId].pending) {
      revert DeferredExecutionNotFound(executionId);
    }

    bytes memory result = poolManager.unlock(
      abi.encode(
        UnlockAction.ResolveDeferredExecution,
        abi.encode(
          ResolveDeferredExecutionCallbackData({
            executionId: executionId,
            requestedExecutionCount: requestedExecutionCount
          })
        )
      )
    );

    return abi.decode(result, (uint256, bool));
  }

  /// @notice Returns an order by pool and per-pool order ID.
  /// @param poolId Pool containing the order.
  /// @param orderId Per-pool order ID.
  /// @return order Stored order.
  function getOrder(PoolId poolId, uint32 orderId) external view returns (Order memory order) {
    return _orders[poolId][orderId];
  }

  /// @notice Returns metadata for a deferred execution ID.
  /// @param executionId Deferred execution ID to inspect.
  /// @return pending Whether the batch is still waiting for resolver work.
  /// @return poolId Pool containing the deferred orders.
  /// @return fromTick Pool tick before the original movement.
  /// @return toTick Pool tick after the original movement.
  /// @return sqrtPriceX96 Pool square-root price after the original movement.
  /// @return nextOrderIndex Next deferred order index to process.
  /// @return orderCount Total order IDs stored for the batch.
  /// @return remainingOrderCount Remaining order IDs to process.
  function getDeferredExecution(
    bytes32 executionId
  )
    external
    view
    returns (
      bool pending,
      PoolId poolId,
      int24 fromTick,
      int24 toTick,
      uint160 sqrtPriceX96,
      uint256 nextOrderIndex,
      uint256 orderCount,
      uint256 remainingOrderCount
    )
  {
    DeferredExecution storage execution = _deferredExecutions[executionId];
    orderCount = execution.orderIds.length;
    nextOrderIndex = execution.nextOrderIndex;
    pending = execution.pending;
    poolId = execution.key.toId();
    fromTick = execution.fromTick;
    toTick = execution.toTick;
    sqrtPriceX96 = execution.sqrtPriceX96;
    remainingOrderCount = orderCount - nextOrderIndex;
  }

  /// @inheritdoc IUnlockCallback
  function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
    if (msg.sender != address(poolManager)) {
      revert UnauthorizedUnlockCallback();
    }

    (UnlockAction action, bytes memory data) = abi.decode(rawData, (UnlockAction, bytes));
    if (action == UnlockAction.CreateOrder) {
      return _createOrderCallback(data);
    }
    if (action == UnlockAction.CancelOrder) {
      return _cancelOrderCallback(data);
    }
    if (action == UnlockAction.ResolveDeferredExecution) {
      return _resolveDeferredExecutionCallback(data);
    }

    revert UnsupportedUnlockAction(uint8(action));
  }

  function _createOrderCallback(bytes memory data) private returns (bytes memory) {
    CreateOrderCallbackData memory callbackData = abi.decode(data, (CreateOrderCallbackData));
    BalanceDelta delta = _modifyLiquidity(
      callbackData.key,
      callbackData.tickLower,
      callbackData.tickUpper,
      int256(uint256(callbackData.liquidity)),
      callbackData.salt,
      callbackData.hookData
    );

    uint256 amountIn = V4DeltaSettlement.settleOrderInput(
      poolManager,
      tokenPuller,
      callbackData.key,
      callbackData.owner,
      callbackData.zeroForOne,
      callbackData.amountInMaximum,
      delta
    );

    return abi.encode(amountIn);
  }

  function _cancelOrderCallback(bytes memory data) private returns (bytes memory) {
    CancelOrderCallbackData memory callbackData = abi.decode(data, (CancelOrderCallbackData));
    BalanceDelta delta = _modifyLiquidity(
      callbackData.key,
      callbackData.order.tickLower,
      callbackData.order.tickUpper,
      -int256(uint256(callbackData.order.liquidity)),
      callbackData.salt,
      callbackData.hookData
    );

    (uint256 amount0, uint256 amount1) = V4DeltaSettlement.takePositiveDeltas(
      poolManager,
      callbackData.key,
      callbackData.owner,
      delta
    );
    return abi.encode(amount0, amount1);
  }

  function _resolveDeferredExecutionCallback(bytes memory data) private returns (bytes memory) {
    ResolveDeferredExecutionCallbackData memory callbackData = abi.decode(
      data,
      (ResolveDeferredExecutionCallbackData)
    );
    DeferredExecution storage execution = _deferredExecutions[callbackData.executionId];
    if (!execution.pending) {
      revert DeferredExecutionNotFound(callbackData.executionId);
    }

    PoolKey memory key = execution.key;
    PoolId poolId = key.toId();
    uint256 orderCount = execution.orderIds.length;
    uint256 remainingOrderCount = orderCount - execution.nextOrderIndex;
    uint256 executionCount = _executionLimit(callbackData.requestedExecutionCount);
    if (executionCount > remainingOrderCount) {
      executionCount = remainingOrderCount;
    }

    int24 adjustedToTick = _adjustedDeferredToTick(poolId, execution.fromTick, execution.toTick);
    for (uint256 i = 0; i < executionCount; ++i) {
      PackedOrderId orderId = execution.orderIds[execution.nextOrderIndex];
      _processOrderId(key, poolId, execution.fromTick, adjustedToTick, orderId);
      ++execution.nextOrderIndex;
    }

    bool complete = execution.nextOrderIndex == orderCount;
    if (complete) {
      delete _deferredExecutions[callbackData.executionId];
    }

    emit DeferredExecutionResolved(callbackData.executionId, poolId, executionCount, complete);
    return abi.encode(executionCount, complete);
  }

  function _processOrderIds(
    PoolKey memory key,
    PoolId poolId,
    int24 fromTick,
    int24 toTick,
    PackedOrderId[] memory orderIds,
    uint256 requestedExecutionCount
  ) private returns (uint256 processedCount) {
    uint256 executionCount = _executionLimit(requestedExecutionCount);
    if (executionCount > orderIds.length) {
      executionCount = orderIds.length;
    }

    for (uint256 i = 0; i < executionCount; ++i) {
      _processOrderId(key, poolId, fromTick, toTick, orderIds[i]);
    }

    return executionCount;
  }

  function _processOrderId(
    PoolKey memory key,
    PoolId poolId,
    int24 fromTick,
    int24 toTick,
    PackedOrderId packedOrderId
  ) private {
    uint32 orderId = packedOrderId.unpack();
    Order memory order = _orders[poolId][orderId];
    if (order.owner == address(0)) {
      return;
    }

    if (
      OrderValidation.isThresholdCrossed(
        order.zeroForOne,
        fromTick,
        toTick,
        order.tickLower,
        order.tickUpper
      )
    ) {
      _executeOrder(key, poolId, orderId, order);
      return;
    }

    if (
      order.enablePartialFill &&
      OrderValidation.isIndexedTickCrossed(order.zeroForOne, fromTick, toTick, order.indexedTick)
    ) {
      _executePartialOrder(key, poolId, orderId, packedOrderId, order, toTick);
      return;
    }

    _orderBooks[poolId].insert(order.indexedTick, packedOrderId);
    emit OrderRequeued(poolId, orderId, order.indexedTick);
  }

  function _storeDeferredExecution(
    PoolKey memory key,
    PoolId poolId,
    int24 fromTick,
    int24 toTick,
    uint160 sqrtPriceX96,
    PackedOrderId[] memory orderIds,
    uint256 startIndex
  ) private returns (bytes32 executionId) {
    uint256 orderCount = orderIds.length - startIndex;
    ++_deferredExecutionNonce;
    executionId = keccak256(
      abi.encode(
        block.chainid,
        address(this),
        poolId,
        fromTick,
        toTick,
        sqrtPriceX96,
        orderCount,
        _deferredExecutionNonce
      )
    );

    DeferredExecution storage execution = _deferredExecutions[executionId];
    execution.pending = true;
    execution.key = key;
    execution.fromTick = fromTick;
    execution.toTick = toTick;
    execution.sqrtPriceX96 = sqrtPriceX96;
    for (uint256 i = startIndex; i < orderIds.length; ++i) {
      execution.orderIds.push(orderIds[i]);
    }

    emit DeferredExecutionStored(executionId, poolId, fromTick, toTick, orderCount);
  }

  function _executionLimit(uint256 requestedExecutionCount) private view returns (uint256 limit) {
    limit = maximumExecutionCount;
    if (requestedExecutionCount != 0 && requestedExecutionCount < limit) {
      return requestedExecutionCount;
    }
  }

  function _adjustedDeferredToTick(
    PoolId poolId,
    int24 fromTick,
    int24 toTick
  ) private view returns (int24 adjustedToTick) {
    (, int24 currentTick, , ) = poolManager.getSlot0(poolId);
    if (toTick > fromTick) {
      return currentTick <= fromTick ? fromTick : currentTick;
    }
    if (toTick < fromTick) {
      return currentTick >= fromTick ? fromTick : currentTick;
    }

    return toTick;
  }

  function _executeOrder(
    PoolKey memory key,
    PoolId poolId,
    uint32 orderId,
    Order memory order
  ) private {
    BalanceDelta delta = _modifyLiquidity(
      key,
      order.tickLower,
      order.tickUpper,
      -int256(uint256(order.liquidity)),
      _positionSalt(orderId),
      ""
    );
    (uint256 amount0, uint256 amount1) = V4DeltaSettlement.takePositiveDeltas(
      poolManager,
      key,
      order.owner,
      delta
    );

    delete _orders[poolId][orderId];
    emit OrderFilled(poolId, orderId, order.owner, amount0, amount1);
  }

  function _initialIndexedTick(
    bool zeroForOne,
    int24 tickLower,
    int24 tickUpper,
    bool enablePartialFill
  ) private pure returns (int24 indexedTick) {
    if (enablePartialFill) {
      return OrderValidation.partialThresholdTick(zeroForOne, tickLower, tickUpper);
    }

    return OrderValidation.thresholdTick(zeroForOne, tickLower, tickUpper);
  }

  function _executePartialOrder(
    PoolKey memory key,
    PoolId poolId,
    uint32 orderId,
    PackedOrderId packedOrderId,
    Order memory order,
    int24 toTick
  ) private {
    PartialExecutionResult memory result = _executePartialLiquidity(key, orderId, order, toTick);
    if (result.remainingLiquidity == 0) {
      delete _orders[poolId][orderId];
      emit OrderPartiallyFilled(
        poolId,
        orderId,
        order.owner,
        result.amount0,
        result.amount1,
        result.tickLower,
        result.tickUpper,
        result.indexedTick,
        0
      );
      return;
    }

    _storePartialOrder(poolId, orderId, packedOrderId, result);

    emit OrderPartiallyFilled(
      poolId,
      orderId,
      order.owner,
      result.amount0,
      result.amount1,
      result.tickLower,
      result.tickUpper,
      result.indexedTick,
      result.remainingLiquidity
    );
  }

  function _executePartialLiquidity(
    PoolKey memory key,
    uint32 orderId,
    Order memory order,
    int24 toTick
  ) private returns (PartialExecutionResult memory result) {
    BalanceDelta removedDelta = _modifyLiquidity(
      key,
      order.tickLower,
      order.tickUpper,
      -int256(uint256(order.liquidity)),
      _positionSalt(orderId),
      ""
    );
    (result.tickLower, result.tickUpper, result.indexedTick) = _remainingPartialRange(
      key.tickSpacing,
      order,
      toTick
    );

    result.remainingLiquidity = _remainingPartialLiquidity(
      order.zeroForOne,
      result.tickLower,
      result.tickUpper,
      removedDelta
    );
    if (result.remainingLiquidity == 0) {
      (result.amount0, result.amount1) = V4DeltaSettlement.takePositiveDeltas(
        poolManager,
        key,
        order.owner,
        removedDelta
      );
      return result;
    }

    BalanceDelta addedDelta = _modifyLiquidity(
      key,
      result.tickLower,
      result.tickUpper,
      int256(uint256(result.remainingLiquidity)),
      _positionSalt(orderId),
      ""
    );
    V4DeltaSettlement.validatePartialAddDelta(order.zeroForOne, addedDelta);
    (result.amount0, result.amount1) = V4DeltaSettlement.takePositiveNetDeltas(
      poolManager,
      key,
      order.owner,
      removedDelta,
      addedDelta
    );
  }

  function _storePartialOrder(
    PoolId poolId,
    uint32 orderId,
    PackedOrderId packedOrderId,
    PartialExecutionResult memory result
  ) private {
    Order storage storedOrder = _orders[poolId][orderId];
    storedOrder.tickLower = result.tickLower;
    storedOrder.tickUpper = result.tickUpper;
    storedOrder.indexedTick = result.indexedTick;
    storedOrder.liquidity = result.remainingLiquidity;
    _orderBooks[poolId].insert(result.indexedTick, packedOrderId);
  }

  function _remainingPartialRange(
    int24 tickSpacing,
    Order memory order,
    int24 toTick
  ) private pure returns (int24 tickLower, int24 tickUpper, int24 indexedTick) {
    if (order.zeroForOne) {
      tickLower = _ceilToSpacing(toTick, tickSpacing);
      if (tickLower < order.tickLower) {
        tickLower = order.tickLower;
      }
      tickUpper = order.tickUpper;
      if (tickLower >= tickUpper) {
        return (tickUpper, tickUpper, tickUpper);
      }

      indexedTick = tickLower;
      if (toTick == tickLower) {
        indexedTick = tickLower + tickSpacing;
      }
      if (indexedTick > tickUpper) {
        indexedTick = tickUpper;
      }
      return (tickLower, tickUpper, indexedTick);
    }

    tickLower = order.tickLower;
    tickUpper = _floorToSpacing(toTick, tickSpacing);
    if (tickUpper > order.tickUpper) {
      tickUpper = order.tickUpper;
    }
    if (tickUpper <= tickLower) {
      return (tickLower, tickLower, tickLower);
    }

    indexedTick = tickUpper;
    if (toTick == tickUpper) {
      indexedTick = tickUpper - tickSpacing;
    }
    if (indexedTick < tickLower) {
      indexedTick = tickLower;
    }
  }

  function _remainingPartialLiquidity(
    bool zeroForOne,
    int24 tickLower,
    int24 tickUpper,
    BalanceDelta removedDelta
  ) private pure returns (uint128 remainingLiquidity) {
    if (tickLower >= tickUpper) {
      return 0;
    }

    uint256 remainingInputAmount =
      zeroForOne
        ? V4DeltaSettlement.positiveDeltaAmount0(removedDelta)
        : V4DeltaSettlement.positiveDeltaAmount1(removedDelta);
    if (remainingInputAmount == 0) {
      return 0;
    }

    return _liquidityForAmount(zeroForOne, tickLower, tickUpper, remainingInputAmount);
  }

  function _modifyLiquidity(
    PoolKey memory key,
    int24 tickLower,
    int24 tickUpper,
    int256 liquidityDelta,
    bytes32 salt,
    bytes memory hookData
  ) private returns (BalanceDelta delta) {
    (delta, ) = poolManager.modifyLiquidity(
      key,
      ModifyLiquidityParams({
        tickLower: tickLower,
        tickUpper: tickUpper,
        liquidityDelta: liquidityDelta,
        salt: salt
      }),
      hookData
    );
  }

  function _validatePoolForOrders(PoolId poolId, PoolKey calldata key) private view {
    if (!poolWhitelisted[poolId]) {
      revert PoolNotWhitelisted(poolId);
    }
    if (!hookRole[address(key.hooks)]) {
      revert PoolHookUnauthorized(address(key.hooks));
    }
  }

  function _requireOrder(PoolId poolId, uint32 orderId) private view returns (Order memory order) {
    order = _orders[poolId][orderId];
    if (order.owner == address(0)) {
      revert OrderNotFound(poolId, orderId);
    }
  }

  function _liquidityForAmount(
    bool zeroForOne,
    int24 tickLower,
    int24 tickUpper,
    uint256 amount
  ) private pure returns (uint128 liquidity) {
    uint160 sqrtPriceLower = TickMath.getSqrtPriceAtTick(tickLower);
    uint160 sqrtPriceUpper = TickMath.getSqrtPriceAtTick(tickUpper);
    if (zeroForOne) {
      return LiquidityAmounts.getLiquidityForAmount0(sqrtPriceLower, sqrtPriceUpper, amount);
    }

    return LiquidityAmounts.getLiquidityForAmount1(sqrtPriceLower, sqrtPriceUpper, amount);
  }

  function _positionSalt(uint32 orderId) private pure returns (bytes32) {
    return bytes32(uint256(orderId));
  }

  function _ceilToSpacing(int24 tick, int24 tickSpacing) private pure returns (int24) {
    int24 floorTick = _floorToSpacing(tick, tickSpacing);
    if (floorTick == tick) {
      return floorTick;
    }

    return floorTick + tickSpacing;
  }

  function _floorToSpacing(int24 tick, int24 tickSpacing) private pure returns (int24) {
    if (tickSpacing <= 0) {
      revert OrderValidation.InvalidTickSpacing(tickSpacing);
    }

    int256 tickValue = int256(tick);
    int256 spacingValue = int256(tickSpacing);
    int256 quotient = tickValue / spacingValue;
    if (tickValue < 0 && tickValue % spacingValue != 0) {
      --quotient;
    }

    return int24(quotient * spacingValue);
  }
}
