import { message } from "@optique/core/message";
import path from "node:path";
import { CliError } from "../../error";
import { providerSchema, type ProviderId } from "./base";

const allProviders = import.meta.glob("./providers/*.ts", {
  eager: false,
});

export const providerIds: readonly ProviderId[] = Object.keys(allProviders).map(
  (key) => path.basename(key, ".ts") as ProviderId,
);

const getProvider = async (id: ProviderId) => {
  const lazyProvider = allProviders[`./providers/${id}.ts`];
  if (!lazyProvider)
    throw new CliError(message`Provider with id ${id} not found`);
  const provider = providerSchema.parse(await lazyProvider());
  return provider;
};

export const getGenerateProvenance = async (id: ProviderId) => {
  const provider = await getProvider(id);
  return provider.generateProvenance.bind(provider);
};

const NOT_ENABLED = Symbol("Not enabled");

export const getFirstEnabledProvider = async () => {
  try {
    return await Promise.any(
      providerIds.map(async (id) => {
        const provider = await getProvider(id);
        if (provider.enable()) return { id, provider };
        else throw NOT_ENABLED;
      }),
    );
  } catch (error) {
    if (error instanceof AggregateError) {
      error.errors = error.errors.filter((e) => e !== NOT_ENABLED);
      if (error.errors.length === 0) return null;
    }
    throw error;
  }
};
