import { BigNumber } from "ethers";


export const ethMultiplier = BigNumber.from(10).pow(18);

export const calcGasCostInCurrency = (
  gas : string,
  gasPriceInGwei : string,
  ethPriceInUSD : string,
) => {
  let cost;
  let currency = "WEI";
  cost = BigNumber.from(gas)
    .mul(BigNumber.from(gasPriceInGwei))
    .mul(ethMultiplier)
    .div(BigNumber.from(10).pow(9));

  if (!!ethPriceInUSD) {
    currency = "USD WEI";
    cost = cost.mul(BigNumber.from(ethPriceInUSD));
  }

  return { cost, currency };
};


// Execute
const [
  gasArg,
  gasPriceArg,
  ethPriceArg,
] = process.argv.slice(2);

const {
  cost: totalCost,
  currency: costCurrency,
} = calcGasCostInCurrency(gasArg, gasPriceArg, ethPriceArg);

console.log(`Total cost: ${totalCost.toString()} ${costCurrency}`);
