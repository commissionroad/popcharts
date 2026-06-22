// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable immutable-vars-naming

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title OutcomeToken
/// @author Pop Charts
/// @notice Per-market ERC20 token for one post-graduation binary outcome.
contract OutcomeToken is ERC20 {
  uint8 private constant MAX_SUPPORTED_DECIMALS = 77;

  /// @notice Reverts when the token is deployed without an owning market.
  error InvalidMarket();
  /// @notice Reverts when the configured decimals can overflow scale factors.
  /// @param tokenDecimals Decimals value that is too large for conversion helpers.
  error UnsupportedOutcomeDecimals(uint8 tokenDecimals);
  /// @notice Reverts when an account other than the owning market tries to mint or burn.
  /// @param account Unauthorized caller.
  error UnauthorizedMarket(address account);

  /// @notice Market contract that is allowed to mint and burn this token.
  address public immutable market;

  uint8 private immutable _outcomeDecimals;

  /// @notice Initializes outcome token metadata and its owning market.
  /// @param name_ ERC20 display name.
  /// @param symbol_ ERC20 ticker symbol.
  /// @param outcomeDecimals_ Decimal precision used by this outcome token.
  /// @param market_ Market contract allowed to mint and burn.
  constructor(
    string memory name_,
    string memory symbol_,
    uint8 outcomeDecimals_,
    address market_
  ) ERC20(name_, symbol_) {
    if (market_ == address(0)) {
      revert InvalidMarket();
    }
    if (outcomeDecimals_ > MAX_SUPPORTED_DECIMALS) {
      revert UnsupportedOutcomeDecimals(outcomeDecimals_);
    }

    market = market_;
    _outcomeDecimals = outcomeDecimals_;
  }

  /// @notice Returns the configured token decimals.
  /// @return Decimal precision used by this outcome token.
  function decimals() public view override returns (uint8) {
    return _outcomeDecimals;
  }

  /// @notice Mints outcome tokens to a recipient.
  /// @param to Recipient of the new outcome tokens.
  /// @param amount Token amount to mint.
  function mint(address to, uint256 amount) external onlyMarket {
    _mint(to, amount);
  }

  /// @notice Burns outcome tokens from an account.
  /// @param from Account whose tokens are burned.
  /// @param amount Token amount to burn.
  function burnFrom(address from, uint256 amount) external onlyMarket {
    _burn(from, amount);
  }

  /// @notice Restricts minting and burning to the owning market.
  modifier onlyMarket() {
    if (msg.sender != market) {
      revert UnauthorizedMarket(msg.sender);
    }
    _;
  }
}
