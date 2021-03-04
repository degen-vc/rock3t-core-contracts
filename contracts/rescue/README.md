## Flash Rescue is a contract designed to migrat LiquidVault LP to a newer LiquidVault (LV henceforth)

### motivation

It was discovered on 23 Feb 2021 that a bug exists in liquid vault that allows anyone who has previously purchased LP
to claim the entire pool of LP once their initial claim is valid.

### Steps required by humans

Note that the best way to tell what humans should do is to look at the test cases that simulate a successful withdrawal.

1. Transfer ownership of LV to FlashRescue.
2. Call FR.seed. Put the correct token address. You must send eth.
3. Call FR.captureConfig as a way to record all of the original config of LV. Don't worry about setting the claim duration low. FR will do this when necessary.
4. Call FR.DoInSequence. The parameter represents how many claim attempts the contract should make in 1 go. Don't worry if you don't get this number just right. DoInSequence will just keep clamining when you call it in the future until all the LP is drained. You can set the number to 1 but it's cheaper gas wise to set the number to higher than 1.
5. At some point, after calling DoInSequence enough, the LP will be transferred to the wallet of the person who owns FlashRescue (deployer).

## Notes

The public variable currentStep can be queried to get a sense of where DoInSequence is. The values are
[Unpurchased, Purchased, FinishedClaiming, Withdrawn]


If an emergency shutdown is required, returnOfOwnership can be invoked which withdraw all LP, transfers LV back to the deployer of FR and any eth still in the FR contract.