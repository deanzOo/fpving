import { describeRepositoryContract } from "@fpving/core/testing";
import { afterEach } from "vitest";
import { cleanUpTemp, openTempSqliteRepository } from "./temp-db.ts";

afterEach(cleanUpTemp);

describeRepositoryContract(openTempSqliteRepository);
