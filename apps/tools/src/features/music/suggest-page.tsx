import { PageHeader } from "@/features/apps/shell"
import { useOutputLibrary } from "./output-library"
import { SuggestedPlaylists } from "./suggested-playlists"

export function SuggestPage() {
  const { reload } = useOutputLibrary()
  return (
    <>
      <PageHeader
        title="Suggest playlists"
        description="Find new output playlists for the music you collect."
      />
      <SuggestedPlaylists onCreate={reload} />
    </>
  )
}
