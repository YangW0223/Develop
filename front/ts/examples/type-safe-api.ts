interface User {
  id: number;
  name: string;
}

interface Product {
  id: number;
  title: string;
  price: number;
}

interface ApiSchema {
  "/users": User[];
  "/products": Product[];
}

type ApiPath = keyof ApiSchema;

type ApiError = {
  kind: "http" | "network" | "invalid-data";
  message: string;
};

type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

type Parser<T> = (input: unknown) => T | undefined;

type Parsers = {
  [P in ApiPath]: Parser<ApiSchema[P]>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseUsers(input: unknown): User[] | undefined {
  if (!Array.isArray(input)) return undefined;

  const valid = input.every(
    item =>
      isRecord(item) &&
      typeof item.id === "number" &&
      typeof item.name === "string",
  );

  return valid ? (input as User[]) : undefined;
}

function parseProducts(input: unknown): Product[] | undefined {
  if (!Array.isArray(input)) return undefined;

  const valid = input.every(
    item =>
      isRecord(item) &&
      typeof item.id === "number" &&
      typeof item.title === "string" &&
      typeof item.price === "number",
  );

  return valid ? (input as Product[]) : undefined;
}

const parsers: Parsers = {
  "/users": parseUsers,
  "/products": parseProducts,
};

export async function apiGet<P extends ApiPath>(
  path: P,
): Promise<Result<ApiSchema[P]>> {
  try {
    const response = await fetch(path);

    if (!response.ok) {
      return {
        ok: false,
        error: { kind: "http", message: `HTTP ${response.status}` },
      };
    }

    const raw: unknown = await response.json();
    const data = parsers[path](raw);

    if (data === undefined) {
      return {
        ok: false,
        error: { kind: "invalid-data", message: "响应格式不正确" },
      };
    }

    return { ok: true, data };
  } catch (error: unknown) {
    return {
      ok: false,
      error: {
        kind: "network",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

// 调用示例（取消注释后需要存在对应接口）：
// const result = await apiGet("/users");
// if (result.ok) {
//   result.data.forEach(user => console.log(user.name));
// } else {
//   console.error(result.error.kind, result.error.message);
// }

