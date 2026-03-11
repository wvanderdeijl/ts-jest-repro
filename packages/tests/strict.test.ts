import { thing } from "library/foo";

const local: 'root-entrypoint-types' = thing;

test("thing", async () => {
  expect(local).toBe('root-entrypoint-cjs');
});
