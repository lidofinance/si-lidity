import type { EthereumProvider } from "hardhat/types/providers";

export class Snapshot {
  private provider: EthereumProvider;

  constructor(provider: EthereumProvider) {
    this.provider = provider;
  }

  public async take(): Promise<string> {
    return this.provider.send("evm_snapshot", []);
  }

  public async restore(snapshot: string): Promise<void> {
    const result = await this.provider.send("evm_revert", [snapshot]);
    if (!result) {
      throw new Error("`evm_revert` failed.");
    }
  }

  public async refresh(snapshot: string): Promise<string> {
    if (snapshot) {
      await this.restore(snapshot);
    }
    return this.take();
  }
}

export function resetState(suite: Mocha.Suite, snapshot: Snapshot) {
  let suiteStartState: string;

  suite.beforeAll(async function () {
    suiteStartState = await snapshot.take();
  });

  suite.afterAll(async function () {
    await snapshot.restore(suiteStartState);
  });
}
