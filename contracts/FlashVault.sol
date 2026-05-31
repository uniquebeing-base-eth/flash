// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal ERC20 surface used by FlashVault.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title  Flash Vault
/// @notice Per-user, non-custodial cUSD vault for the Flash MiniPay perp app.
///         Users deposit cUSD (or any single configured ERC20), accrue an
///         internal balance, trade in the app off-chain, and withdraw at any
///         time. The owner cannot move user funds — only the depositor can
///         withdraw their own balance.
///
/// @dev    Design goals:
///         - Single asset (immutable) — no token confusion, minimal storage.
///         - Reentrancy-safe via checks-effects-interactions + simple guard.
///         - Pausable deposits (not withdrawals) so users can always exit.
///         - No upgrades, no admin withdrawals, no fees.
contract FlashVault {
    /// @notice The single ERC20 accepted by this vault (e.g. cUSD on Celo).
    IERC20 public immutable asset;

    /// @notice Contract owner. Can pause deposits and transfer ownership.
    ///         Cannot touch user balances under any circumstance.
    address public owner;

    /// @notice When true, new deposits are rejected. Withdrawals stay open.
    bool public depositsPaused;

    /// @notice Per-user internal balance, denominated in `asset` base units.
    mapping(address => uint256) public balanceOf;

    /// @notice Sum of all internal balances. Should equal asset.balanceOf(this).
    uint256 public totalDeposits;

    // Simple non-reentrant guard.
    uint256 private _locked = 1;

    event Deposited(address indexed user, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed user, uint256 amount, uint256 newBalance);
    event DepositsPausedSet(bool paused);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error ZeroAmount();
    error InsufficientBalance();
    error TransferFailed();
    error DepositsArePaused();
    error NotOwner();
    error Reentrancy();
    error ZeroAddress();

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @param _asset The ERC20 to accept (e.g. cUSD: 0x765DE816845861e75A25fCA122bb6898B8B1282a on Celo).
    constructor(address _asset) {
        if (_asset == address(0)) revert ZeroAddress();
        asset = IERC20(_asset);
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /// @notice Deposit `amount` of `asset` into the vault.
    /// @dev    Caller must first call `asset.approve(vault, amount)`.
    function deposit(uint256 amount) external nonReentrant {
        if (depositsPaused) revert DepositsArePaused();
        if (amount == 0) revert ZeroAmount();

        // Effects first.
        balanceOf[msg.sender] += amount;
        totalDeposits += amount;

        // Interaction last.
        bool ok = asset.transferFrom(msg.sender, address(this), amount);
        if (!ok) revert TransferFailed();

        emit Deposited(msg.sender, amount, balanceOf[msg.sender]);
    }

    /// @notice Withdraw `amount` of `asset` from the vault back to the caller.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 bal = balanceOf[msg.sender];
        if (amount > bal) revert InsufficientBalance();

        unchecked {
            balanceOf[msg.sender] = bal - amount;
            totalDeposits -= amount;
        }

        bool ok = asset.transfer(msg.sender, amount);
        if (!ok) revert TransferFailed();

        emit Withdrawn(msg.sender, amount, balanceOf[msg.sender]);
    }

    /// @notice Withdraw the caller's entire balance.
    function withdrawAll() external nonReentrant {
        uint256 bal = balanceOf[msg.sender];
        if (bal == 0) revert InsufficientBalance();

        balanceOf[msg.sender] = 0;
        totalDeposits -= bal;

        bool ok = asset.transfer(msg.sender, bal);
        if (!ok) revert TransferFailed();

        emit Withdrawn(msg.sender, bal, 0);
    }

    // --- Owner controls (deposits only; cannot touch user funds) ---

    function setDepositsPaused(bool paused) external onlyOwner {
        depositsPaused = paused;
        emit DepositsPausedSet(paused);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}