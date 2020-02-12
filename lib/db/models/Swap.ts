import { Model, Sequelize, DataTypes } from 'sequelize';
import Pair from './Pair';

type SwapType = {
  id: string;

  keyIndex: number;
  redeemScript: string;

  fee?: number;
  routingFee?: number;
  minerFee?: number;

  pair: string;
  orderSide: number;

  status: string;

  preimageHash: string;
  invoice?: string;

  acceptZeroConf?: boolean;
  timeoutBlockHeight: number;
  expectedAmount?: number;
  onchainAmount?: number;
  lockupAddress: string;
  lockupTransactionId?: string;
};

class Swap extends Model implements SwapType {
  public id!: string;

  public keyIndex!: number;
  public redeemScript!: string;

  public fee?: number;
  public routingFee?: number;
  public minerFee?: number;

  public pair!: string;
  public orderSide!: number;

  public status!: string;

  public preimageHash!: string;
  public invoice?: string;

  public acceptZeroConf?: boolean;
  public timeoutBlockHeight!: number;
  public expectedAmount?: number;
  public onchainAmount?: number;
  public lockupAddress!: string;
  public lockupTransactionId?: string;

  public createdAt!: string;
  public updatedAt!: string;

  public static load = (sequelize: Sequelize) => {
    Swap.init({
      id: { type: new DataTypes.STRING(255), primaryKey: true, allowNull: false },
      keyIndex: { type: new DataTypes.INTEGER(), allowNull: false },
      redeemScript: { type: new DataTypes.STRING(255), allowNull: false },
      fee: { type: new DataTypes.INTEGER(), allowNull: true },
      routingFee: { type: new DataTypes.INTEGER(), allowNull: true },
      minerFee: { type: new DataTypes.INTEGER(), allowNull: true },
      pair: { type: new DataTypes.STRING(255), allowNull: false },
      orderSide: { type: new DataTypes.INTEGER(), allowNull: false },
      status: { type: new DataTypes.STRING(255), allowNull: false },
      preimageHash: { type: new DataTypes.STRING(255), unique: true, allowNull: false },
      invoice: { type: new DataTypes.STRING(255), unique: true, allowNull: true },
      acceptZeroConf: { type: DataTypes.BOOLEAN, allowNull: true },
      timeoutBlockHeight: { type: new DataTypes.INTEGER(), allowNull: false },
      expectedAmount: { type: new DataTypes.INTEGER(), allowNull: true },
      onchainAmount: { type: new DataTypes.INTEGER(), allowNull: true },
      lockupAddress: { type: new DataTypes.STRING(255), allowNull: false },
      lockupTransactionId: { type: new DataTypes.STRING(255), allowNull: true },
    }, {
      sequelize,
      tableName: 'swaps',
      indexes: [
        {
          unique: true,
          fields: ['id', 'invoice'],
        },
      ],
    });

    Swap.belongsTo(Pair, {
      foreignKey: 'pair',
    });
  }
}

export default Swap;
export { SwapType };
