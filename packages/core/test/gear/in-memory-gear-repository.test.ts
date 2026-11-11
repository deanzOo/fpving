import { describeGearRepositoryContract, InMemoryGearRepository } from "../../src/testing/index.ts";

describeGearRepositoryContract(async () => Promise.resolve(new InMemoryGearRepository()));
