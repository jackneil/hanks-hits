import { SharedClipPage } from "@/shared/clips/ui/SharedClipPage";
export default async function ClipPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ game?: string }>;
}) {
  const { id } = await params;
  const { game } = await searchParams;
  return <SharedClipPage id={id} gameId={game} />;
}
