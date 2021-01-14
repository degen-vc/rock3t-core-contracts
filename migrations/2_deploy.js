require('dotenv').config();

const FeeApprover = artifacts.require('FeeApprover');
const FeeDistributor = artifacts.require('FeeDistributor');
const RocketToken = artifacts.require('RocketToken');
const LiquidVault = artifacts.require('LiquidVault');
const SlidingWindowOracle = artifacts.require('SlidingWindowOracle');

const { 
    UNISWAP_FACTORY, 
    UNISWAP_ROUTER,
    TREASURY,
    FEE_RECEIVER,
    SECONDARY_ADDRESS_SHARE
} = process.env;

module.exports = async function (deployer, network, accounts) {
    const defaultWindowSize = 86400 // 24 hours
    const defaultGranularity = 24 // 1 hour each

    if (network === 'development') {
        return;
    }

    await deployer.deploy(FeeApprover);
    const feeApproverInstance = await FeeApprover.deployed();
    await pausePromise('Fee Approver');

    await deployer.deploy(FeeDistributor);
    const feeDistributorInstance = await FeeDistributor.deployed();
    await pausePromise('Fee Distributor');

    await deployer.deploy(RocketToken, feeDistributorInstance.address, feeApproverInstance.address, UNISWAP_ROUTER, UNISWAP_FACTORY);
    const rocketTokenInstance = await RocketToken.deployed();
    await pausePromise('RocketToken');

    await deployer.deploy(LiquidVault);
    const liquidVaultInstance = await LiquidVault.deployed();
    await pausePromise('Liquidity Vault');

    await deployer.deploy(SlidingWindowOracle, UNISWAP_FACTORY, defaultWindowSize, defaultGranularity);
    const uniswapOracle = await SlidingWindowOracle.deployed();
    
    const uniswapPair = await rocketTokenInstance.tokenUniswapPair();

    await pausePromise('seed fee approver');
    await feeApproverInstance.initialize(rocketTokenInstance.address, UNISWAP_FACTORY, UNISWAP_ROUTER, liquidVaultInstance.address);
    await feeApproverInstance.unPause();

    await pausePromise('seed fee distributor');
    await feeDistributorInstance.seed(
        rocketTokenInstance.address, 
        liquidVaultInstance.address, 
        FEE_RECEIVER, 
        SECONDARY_ADDRESS_SHARE
    );
    await pausePromise('seed liquidity vault');
    await liquidVaultInstance.seed(
      rocketTokenInstance.address, 
      feeDistributorInstance.address,
      UNISWAP_ROUTER,
      uniswapPair,
      TREASURY,
      uniswapOracle.address
    );

}

function pausePromise(message, durationInSeconds = 2) {
	return new Promise(function (resolve, error) {
		setTimeout(() => {
			console.log(message);
			return resolve();
		}, durationInSeconds * 1000);
	});
}