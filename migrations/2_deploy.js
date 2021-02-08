require('dotenv').config();

const FeeApprover = artifacts.require('FeeApprover');
const FeeDistributor = artifacts.require('FeeDistributor');
const RocketToken = artifacts.require('RocketToken');
const LiquidVault = artifacts.require('LiquidVault');
const PriceOracle = artifacts.require('PriceOracle');

const { 
    UNISWAP_FACTORY, 
    UNISWAP_ROUTER,
    TREASURY,
    FEE_RECEIVER,
    SECONDARY_ADDRESS_SHARE,
    WETH_KOVAN
} = process.env;

module.exports = async function (deployer, network, accounts) {

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

    let uniswapPair;
    let uniswapOracle;

    await pausePromise('seed fee approver');
    // create uniswap pair manually on production and initialize/unpause fee approver
    if (network !== 'mainnet') {
        await rocketTokenInstance.createUniswapPair();
        uniswapPair = await rocketTokenInstance.tokenUniswapPair();

        uniswapOracle = await deployer.deploy(PriceOracle, uniswapPair, rocketTokenInstance.address, WETH_KOVAN);

        await feeApproverInstance.initialize(uniswapPair, liquidVaultInstance.address);
        await feeApproverInstance.unPause();
    }

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