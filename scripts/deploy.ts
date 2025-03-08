import { ethers } from "hardhat";

async function main() {
  // Get the deployer's account
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // Deploy the UniswapV3Pool contract with a manual gas limit
  const UniswapV3Pool = await ethers.getContractFactory("UniswapV3Pool");
  const uniswapV3Pool = await UniswapV3Pool.deploy({
    gasLimit: 10_000_000, // Set a higher gas limit
  });
  await uniswapV3Pool.deployed();
  console.log("UniswapV3Pool deployed to:", uniswapV3Pool.address);

  // Deploy the DynamicFeeWrapper contract with a manual gas limit
  const DynamicFeeWrapper = await ethers.getContractFactory("DynamicFeeWrapper");
  const dynamicFeeWrapper = await DynamicFeeWrapper.deploy(uniswapV3Pool.address, {
    gasLimit: 10_000_000, // Set a higher gas limit
  });
  await dynamicFeeWrapper.deployed();
  console.log("DynamicFeeWrapper deployed to:", dynamicFeeWrapper.address);
}

// Run the deployment script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
