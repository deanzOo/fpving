import { inMemoryRepository } from "./fakes/in-memory-repository.ts";
import { describeRepositoryContract } from "./repository-contract.ts";

describeRepositoryContract("In-memory", async () => Promise.resolve(inMemoryRepository()));
