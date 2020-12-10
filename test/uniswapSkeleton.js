const Ganache = require('./helpers/ganache');
const deployUniswap = require('./helpers/deployUniswap');

contract('Uniswap skeleton contracts', function(accounts) {
  const ganache = new Ganache(web3);
  afterEach('revert', ganache.revert);

  const bn = (input) => web3.utils.toBN(input);
  const assertBNequal = (bnOne, bnTwo) => assert.equal(bnOne.toString(), bnTwo.toString());

  let uniswapFactory;
  let uniswapRouter;
  let weth;

  before('setup others', async function() {
    const contracts = await deployUniswap(accounts);
    uniswapFactory = contracts.uniswapFactory;
    uniswapRouter = contracts.uniswapRouter;
    weth = contracts.weth;

    await ganache.snapshot();
  });

  describe('Uniswap contracts deploy', async () => {
    it('should be possible to get deployed uniswap factory, weth and router', async () => {
      console.log(uniswapFactory.address);
      console.log(weth.address);
      console.log(uniswapRouter.address);

      assert.equal(await uniswapRouter.factory(), uniswapFactory.address);
      assert.equal(await uniswapRouter.WETH(), weth.address);
    });
  });

});
