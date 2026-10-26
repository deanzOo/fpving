import { describeRepositoryContract } from "../src/testing/index.ts";
import { inMemoryRepository } from "./fakes/in-memory-repository.ts";

describeRepositoryContract(async () => Promise.resolve(inMemoryRepository()));
