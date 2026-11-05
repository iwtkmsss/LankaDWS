import { CompactFileName } from '../../shared/ui'

export function DriveFileName({ file, className = 'drive-tile__name' }: {
  file: { name: string; extension?: string | null }
  className?: string
}) {
  const extension = file.extension && !file.name.toLowerCase().endsWith(file.extension.toLowerCase()) ? file.extension : ''
  return <CompactFileName fileName={`${file.name}${extension}`} className={className} />
}
