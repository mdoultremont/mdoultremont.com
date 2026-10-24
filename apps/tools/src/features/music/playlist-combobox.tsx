import { Combobox } from "@base-ui/react/combobox"
import { useId } from "react"
import type { SpotifyPlaylist } from "@mdoultremont/tools-contracts/music"
import { FieldLabel } from "@/features/ui/field"
import { Input } from "@/features/ui/input"

export function PlaylistCombobox({
  playlists,
  value,
  selected,
  open,
  disabled,
  onValueChange,
  onOpenChange,
  onSelect,
  onCreate,
}: {
  readonly playlists: readonly SpotifyPlaylist[]
  readonly value: string
  readonly selected: SpotifyPlaylist | null
  readonly open: boolean
  readonly disabled: boolean
  readonly onValueChange: (value: string) => void
  readonly onOpenChange: (open: boolean) => void
  readonly onSelect: (playlist: SpotifyPlaylist) => void
  readonly onCreate?: (name: string) => void
}) {
  const generatedId = useId()
  const inputId = `${generatedId}-input`
  const query = value.trim().toLocaleLowerCase()
  const matches = playlists.filter((playlist) =>
    playlist.name.toLocaleLowerCase().includes(query)
  )
  const canCreate = Boolean(onCreate && value.trim()) && matches.length === 0
  const options: PlaylistOption[] = matches.map((playlist) => ({
    kind: "playlist",
    playlist,
    label: playlist.name,
  }))
  if (canCreate)
    options.push({
      kind: "create",
      name: value.trim(),
      label: `Create “${value.trim()}”`,
    })
  const selectedOption: PlaylistOption | null = selected
    ? { kind: "playlist", playlist: selected, label: selected.name }
    : null

  return (
    <Combobox.Root<PlaylistOption>
      autoComplete="list"
      disabled={disabled}
      filter={null}
      inputValue={value}
      isItemEqualToValue={(option, candidate) => {
        if (option.kind === "create" && candidate.kind === "create")
          return option.name === candidate.name
        if (option.kind === "playlist" && candidate.kind === "playlist")
          return option.playlist.id === candidate.playlist.id
        return false
      }}
      itemToStringLabel={(option) => option.label}
      items={options}
      onInputValueChange={(nextValue, details) => {
        if (details.reason === "input-change") onValueChange(nextValue)
      }}
      onOpenChange={onOpenChange}
      open={open}
      value={selectedOption}
    >
      <div className="relative flex flex-col gap-2">
        <FieldLabel htmlFor={inputId}>Search Spotify playlists</FieldLabel>
        <Combobox.Input
          id={inputId}
          placeholder="Type a playlist name"
          render={<Input />}
        />
        <Combobox.Portal>
          <Combobox.Positioner className="z-50 outline-none" sideOffset={4}>
            <Combobox.Popup className="max-h-60 w-(--anchor-width) overflow-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
              <Combobox.Empty className="px-2 py-1.5 text-sm text-muted-foreground">
                No matching playlists
              </Combobox.Empty>
              <Combobox.List>
                {(option: PlaylistOption) => (
                  <Combobox.Item
                    key={
                      option.kind === "create"
                        ? `create-${option.name}`
                        : option.playlist.id
                    }
                    value={option}
                    className="cursor-pointer rounded-md px-2 py-1.5 text-sm outline-none hover:bg-muted data-highlighted:bg-muted"
                    onClick={() => {
                      if (option.kind === "create") onCreate?.(option.name)
                      else onSelect(option.playlist)
                    }}
                  >
                    {option.label}
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </div>
    </Combobox.Root>
  )
}

type PlaylistOption =
  | {
      readonly kind: "playlist"
      readonly playlist: SpotifyPlaylist
      readonly label: string
    }
  | {
      readonly kind: "create"
      readonly name: string
      readonly label: string
    }
