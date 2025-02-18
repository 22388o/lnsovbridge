import { ContractABIs } from 'boltz-core';
import { ERC20 } from 'boltz-core/typechain/ERC20';
import { EtherSwap } from 'boltz-core/typechain/EtherSwap';
import { ERC20Swap } from 'boltz-core/typechain/ERC20Swap';
import { constants, Contract, utils, Wallet as EthersWallet } from 'ethers';
import GasNow from './GasNow';
import Errors from '../Errors';
import Wallet from '../Wallet';
import Logger from '../../Logger';
import { stringify } from '../../Utils';
import { RskConfig } from '../../Config';
import ContractHandler from './ContractHandler';
import InjectedProvider from './InjectedProvider';
import { CurrencyType } from '../../consts/Enums';
import ContractEventHandler from './ContractEventHandler';
import ChainTipRepository from '../../db/ChainTipRepository';
import EtherWalletProvider from '../providers/EtherWalletProvider';
import ERC20WalletProvider from '../providers/ERC20WalletProvider';
import EthereumTransactionTracker from './EthereumTransactionTracker';

type Network = {
  chainId: number;

  // Undefined for networks that are not recognised by Ethers
  name?: string;
};

class RskManager {
  public provider: InjectedProvider;

  public contractHandler: ContractHandler;
  public contractEventHandler: ContractEventHandler;

  public etherSwap: EtherSwap;
  public erc20Swap: ERC20Swap;

  public address!: string;
  public network!: Network;

  public tokenAddresses = new Map<string, string>();

  private static supportedContractVersions = {
    'EtherSwap': 2,
    'ERC20Swap': 2,
  };

  constructor(
    private logger: Logger,
    private rskConfig: RskConfig,
  ) {
    if (this.rskConfig.rbtcSwapAddress === '' || this.rskConfig.erc20SwapAddress === '') {
      throw Errors.MISSING_SWAP_CONTRACTS();
    }

    this.logger.info("this.rskConfig: "+ JSON.stringify(this.rskConfig));
    this.provider = new InjectedProvider(
      this.logger,
      this.rskConfig,
    );
    this.logger.info("rskprovider: "+ JSON.stringify(this.provider));

    this.logger.info("rskprovider: "+ JSON.stringify(this.provider));

    this.logger.debug(`Using Rsk Swap contract: ${this.rskConfig.rbtcSwapAddress}`);
    this.logger.debug(`Using Rsk ERC20 Swap contract: ${this.rskConfig.erc20SwapAddress}`);

    this.etherSwap = new Contract(
      this.rskConfig.rbtcSwapAddress,
      ContractABIs.EtherSwap as any,
      this.provider,
    ) as any as EtherSwap;
    this.logger.info("rsk etherSwap done")

    this.erc20Swap = new Contract(
      this.rskConfig.erc20SwapAddress,
      ContractABIs.ERC20Swap as any,
      this.provider,
    ) as any as ERC20Swap;

    this.contractHandler = new ContractHandler(this.logger);
    this.logger.info("rsk ContractHandler done")
    this.contractEventHandler = new ContractEventHandler(this.logger);
    this.logger.info("rsk ContractEventHandler done")
  }

  public init = async (mnemonic: string, chainTipRepository: ChainTipRepository): Promise<Map<string, Wallet>> => {
    await this.provider.init();
    this.logger.info('Initialized web3 providers');

    const network = await this.provider.getNetwork();
    this.network = {
      name: network.name !== 'unknown' ? network.name : undefined,
      chainId: network.chainId,
    };

    const signer = EthersWallet.fromMnemonic(mnemonic).connect(this.provider);
    this.address = await signer.getAddress();

    this.etherSwap = this.etherSwap.connect(signer);
    this.erc20Swap = this.erc20Swap.connect(signer);

    await Promise.all([
      this.checkContractVersion('EtherSwap', this.etherSwap, RskManager.supportedContractVersions.EtherSwap),
      this.checkContractVersion('ERC20Swap', this.erc20Swap, RskManager.supportedContractVersions.ERC20Swap),
    ]);

    this.logger.verbose(`Using Rsk signer: ${this.address} on network ${this.network}`);

    const currentBlock = await signer.provider!.getBlockNumber();
    this.logger.error("RskManager currentBlock: "+ currentBlock);
    const chainTip = await chainTipRepository.findOrCreateTip('RBTC', currentBlock);

    this.contractHandler.init(this.etherSwap, this.erc20Swap);
    this.contractEventHandler.init(this.etherSwap, this.erc20Swap);

    this.logger.verbose(`Rsk chain status: ${stringify({
      chainId: await signer.getChainId(),
      blockNumber: currentBlock,
    })}`);

    await new GasNow(
      this.logger,
      await this.provider.getNetwork(),
    ).init();
    const transactionTracker = await new EthereumTransactionTracker(
      this.logger,
      this.provider,
      signer,
    );

    await transactionTracker.init();

    this.provider.on('block', async (blockNumber: number) => {
      this.logger.silly(`Got new Ethereum block: ${ blockNumber }`);

      await Promise.all([
        chainTipRepository.updateTip(chainTip, blockNumber),
        transactionTracker.scanBlock(blockNumber),
      ]);
    });

    const wallets = new Map<string, Wallet>();

    for (const token of this.rskConfig.tokens) {
      if (token.contractAddress) {
        if (token.decimals) {
          if (!wallets.has(token.symbol)) {
            // Wrap the address in "utils.getAddress" to make sure it is a checksum one
            this.tokenAddresses.set(token.symbol, utils.getAddress(token.contractAddress));
            const provider = new ERC20WalletProvider(this.logger, signer, {
              symbol: token.symbol,
              decimals: token.decimals,
              contract: new Contract(token.contractAddress, ContractABIs.ERC20, signer) as any as ERC20,
            });

            wallets.set(token.symbol, new Wallet(
              this.logger,
              CurrencyType.ERC20,
              provider,
            ));

            await this.checkERC20Allowance(provider);
          } else {
            throw Errors.INVALID_ETHEREUM_CONFIGURATION(`duplicate ${token.symbol} token config`);
          }
        } else {
          throw Errors.INVALID_ETHEREUM_CONFIGURATION(`missing decimals configuration for token: ${token.symbol}`);
        }
      } else {
        if (token.symbol === 'RBTC') {
          if (!wallets.has('RBTC')) {
            wallets.set('RBTC', new Wallet(
              this.logger,
              CurrencyType.Rbtc,
              new EtherWalletProvider(this.logger, signer),
            ));
          } else {
            throw Errors.INVALID_ETHEREUM_CONFIGURATION('duplicate Ether token config');
          }
        } else {
          throw Errors.INVALID_ETHEREUM_CONFIGURATION(`missing token contract address for: ${stringify(token)}`);
        }
      }
    }

    return wallets;
  }

  private checkERC20Allowance = async (erc20Wallet: ERC20WalletProvider) => {
    const allowance = await erc20Wallet.getAllowance(this.rskConfig.erc20SwapAddress);

    this.logger.debug(`Allowance of ${erc20Wallet.symbol} is ${allowance.toString()}`);

    if (allowance.isZero()) {
      this.logger.verbose(`Setting allowance of ${erc20Wallet.symbol}`);

      const { transactionId } = await erc20Wallet.approve(
        this.rskConfig.erc20SwapAddress,
        constants.MaxUint256,
      );

      this.logger.info(`Set allowance of token ${erc20Wallet.symbol }: ${transactionId}`);
    }
  }

  private checkContractVersion = async (name: string, contract: EtherSwap | ERC20Swap, supportedVersion: number) => {
    const contractVersion = await contract.version();

    if (contractVersion !== supportedVersion) {
      throw Errors.UNSUPPORTED_CONTRACT_VERSION(name, contract.address, contractVersion, supportedVersion);
    }
  }
}

export default RskManager;
export { Network };
