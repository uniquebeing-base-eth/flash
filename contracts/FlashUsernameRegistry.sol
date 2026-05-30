// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title  Flash Username Registry
/// @notice Minimal, gas-optimised on-chain identity layer for the Flash MiniPay
///         perpetual trading app. Each wallet may register exactly one username.
///         Each username (case-insensitive) may be claimed exactly once.
/// @dev    Designed to be as cheap as possible:
///           - usernames are stored as a `bytes32` keccak256 hash of the
///             lowercased string for the uniqueness check
///           - the human-readable string is also stored per wallet so the
///             frontend can render it without extra calls
///           - no admin, no upgrades, no transfers, no profiles
contract FlashUsernameRegistry {
    // wallet => chosen username (original casing preserved)
    mapping(address => string) public usernameOf;

    // keccak256(lowercase username) => taken?
    mapping(bytes32 => bool) public takenUsernames;

    // total registrations (handy for hackathon on-chain metrics)
    uint256 public totalUsers;

    event UserRegistered(
        address indexed wallet,
        string username,
        uint256 timestamp
    );

    error AlreadyRegistered();
    error UsernameTaken();
    error InvalidLength();
    error InvalidCharacter(uint256 index);

    /// @notice Claim a username for `msg.sender`.
    /// @param  username  3-24 chars, [a-zA-Z0-9_] only. Case-insensitive uniqueness.
    function registerUser(string calldata username) external {
        if (bytes(usernameOf[msg.sender]).length != 0) revert AlreadyRegistered();

        bytes memory raw = bytes(username);
        uint256 len = raw.length;
        if (len < 3 || len > 24) revert InvalidLength();

        // Build lowercased copy in memory and validate charset in a single pass.
        bytes memory lower = new bytes(len);
        for (uint256 i = 0; i < len; ) {
            bytes1 ch = raw[i];
            if (ch >= 0x41 && ch <= 0x5A) {
                // A-Z -> a-z
                lower[i] = bytes1(uint8(ch) + 32);
            } else if (
                (ch >= 0x61 && ch <= 0x7A) || // a-z
                (ch >= 0x30 && ch <= 0x39) || // 0-9
                ch == 0x5F                    // _
            ) {
                lower[i] = ch;
            } else {
                revert InvalidCharacter(i);
            }
            unchecked { ++i; }
        }

        bytes32 key = keccak256(lower);
        if (takenUsernames[key]) revert UsernameTaken();

        takenUsernames[key] = true;
        usernameOf[msg.sender] = username;
        unchecked { ++totalUsers; }

        emit UserRegistered(msg.sender, username, block.timestamp);
    }

    /// @notice Check availability without sending a transaction.
    function isAvailable(string calldata username) external view returns (bool) {
        bytes memory raw = bytes(username);
        uint256 len = raw.length;
        if (len < 3 || len > 24) return false;

        bytes memory lower = new bytes(len);
        for (uint256 i = 0; i < len; ) {
            bytes1 ch = raw[i];
            if (ch >= 0x41 && ch <= 0x5A) {
                lower[i] = bytes1(uint8(ch) + 32);
            } else if (
                (ch >= 0x61 && ch <= 0x7A) ||
                (ch >= 0x30 && ch <= 0x39) ||
                ch == 0x5F
            ) {
                lower[i] = ch;
            } else {
                return false;
            }
            unchecked { ++i; }
        }

        return !takenUsernames[keccak256(lower)];
    }

    /// @notice Has this wallet already registered?
    function isRegistered(address wallet) external view returns (bool) {
        return bytes(usernameOf[wallet]).length != 0;
    }
}