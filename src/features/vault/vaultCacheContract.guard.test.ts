import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Vault cache ownership guard", () => {
  it("keeps primary Vault consumers on the canonical cache boundary", () => {
    for (const path of [
      "src/pages/VaultPage.tsx",
      "src/components/UploadPhotoSheet.tsx",
    ]) {
      expect(read(path), `${path} should import the Vault cache boundary`).toContain(
        '@/features/vault/vaultCacheCompletion',
      );
    }
  });

  it("does not reintroduce inline shared Vault cache keys in mutation completion", () => {
    const consumers = [
      read("src/pages/VaultPage.tsx"),
      read("src/components/UploadPhotoSheet.tsx"),
    ].join("\n");

    expect(consumers).not.toMatch(
      /(?:invalidateQueries|cancelQueries|getQueryData|setQueryData)\(\s*(?:\{\s*queryKey:\s*)?\[\s*["'](?:vault-files|vault-subfolders|vault-trash|storage-breakdown|club-free-usage|photos)["']/,
    );
  });

  it("keeps VaultPage read queries on canonical Vault keys", () => {
    const page = read("src/pages/VaultPage.tsx");
    for (const root of [
      "vault-clubs",
      "vault-club-has-pro",
      "vault-team-has-pro",
      "vault-club-teams",
      "vault-team-folders",
      "vault-club-mini-leagues",
      "vault-subfolders",
      "vault-files",
      "vault-folder-tree",
      "vault-recursive-search",
      "vault-trash",
      "storage-breakdown",
    ]) {
      expect(page).not.toMatch(new RegExp(`queryKey:\\s*\\[\\s*["']${root}["']`));
    }
  });
});
