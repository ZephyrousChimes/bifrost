import { Pool, PoolClient } from "pg";

export type Queryable = Pool | PoolClient;
