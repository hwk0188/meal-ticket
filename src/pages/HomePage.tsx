import type { Person } from '../features/auth/usePerson'

export function HomePage({ person }: { person: Person }) {
  return <main className="p-6"><h1 className="text-2xl font-extrabold">{person.name} 님</h1></main>
}
