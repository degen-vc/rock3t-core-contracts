require('dotenv').config();

const FeeDistributor = artifacts.require('FeeDistributor');
const RocketToken = artifacts.require('RocketToken');
const LiquidVault = artifacts.require('LiquidVault');

const { 
    UNISWAP_FACTORY, 
    UNISWAP_ROUTER,
    TREASURY,
    FEE_RECEIVER
} = process.env;

module.exports = async function (deployer, network, accounts) {
    const fee = 0 // 1%;
    const blackHoleFee = 10 // 1%;
    const rocketFee = 10;

    if (network === 'development') {
        return;
    }
    await deployer.deploy(FeeDistributor);
    const feeDistributorInstance = await FeeDistributor.deployed();
    await pausePromise('fee Distributor');

    await deployer.deploy(RocketToken, 10, feeDistributorInstance.address, UNISWAP_ROUTER, UNISWAP_FACTORY);
    const rocketTokenInstance = await RocketToken.deployed();
    await pausePromise('RocketToken');

    await deployer.deploy(LiquidVault);
    const liquidVaultInstance = await LiquidVault.deployed();
    await pausePromise('liquidity vault');
    
    const uniswapPair = await rocketTokenInstance.tokenUniswapPair();

    await pausePromise('seed fee distributor');
    await feeDistributorInstance.seed(
        rocketTokenInstance.address, 
        liquidVaultInstance.address, 
        FEE_RECEIVER, 
        fee
    );
    await pausePromise('seed liquidity vault');
    await liquidVaultInstance.seed(
      rocketTokenInstance.address, 
      feeDistributorInstance.address,
      blackHoleFee,
      UNISWAP_ROUTER,
      uniswapPair,
      TREASURY
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