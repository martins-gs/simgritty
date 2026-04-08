import ConfirmClient from "./confirm-client";

interface Props {
  searchParams: Promise<{
    token_hash?: string;
    type?: string;
    code?: string;
    next?: string;
  }>;
}

export default async function ConfirmPage({ searchParams }: Props) {
  const { token_hash, type, code } = await searchParams;
  return <ConfirmClient token_hash={token_hash} type={type} code={code} />;
}
