import { Flex, Heading } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { getApi } from "../../../shared/api";
import Constants from "../../../shared/constants";
import { getProviders } from "../../../shared/localStorage/providers";
import { capture } from "../../../shared/notifications";
import Providers from "./providers";

export type DefaultProvider = {
  name: string;
  image: string;
};

const ConnectProviders = () => {
  const [connectedProviders, setConnectedProviders] = useState<string[]>([]);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    // TODO: NPM I  AND ADD ZOD TO INCOMING REQUEST
    async function getConnectedProviders() {
      if (isDemo) return;
      try {
        const { data } = await getApi().get("/connect/user/providers");
        setConnectedProviders(data);
      } catch (err) {
        capture.error(err, { extra: { context: `provider.list.get` } });
      }
    }
    getConnectedProviders();
  }, []);

  const searchProviders = searchParams.get(Constants.PROVIDERS_PARAM);
  const token = searchParams.get(Constants.TOKEN_PARAM);
  const isDemo = token === "demo";
  const isApple = searchParams.get(Constants.APPLE_PARAM);
  const providers = getProviders(searchProviders, isDemo, isApple);

  return (
    <>
      <Flex justify={"center"}>
        <Heading mb={2} textAlign={"center"}>
          Connect your sources.
        </Heading>
      </Flex>
      <Providers
        providers={providers}
        connectedProviders={connectedProviders}
        setConnectedProviders={setConnectedProviders}
      />
    </>
  );
};

export default ConnectProviders;
