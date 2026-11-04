// Facts the Terms and Privacy pages print. The company behind Gusto is not
// written into the repository: the operator block comes from the environment
// (read at build time, like NEXT_PUBLIC_* values), and the block is left out
// until LEGAL_ENTITY_NAME is set. Nothing here is a placeholder shown to users.

/** Date of the current wording. Change it whenever the text in messages/ka.json (`legal`) changes. */
export const LEGAL_UPDATED = "2026-11-03";

export type LegalOperator = {
  name: string;
  id: string | null;
  address: string | null;
  email: string | null;
};

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Where people who are not yet accepted can write; null until LEGAL_CONTACT_EMAIL is set. */
export function contactEmail(): string | null {
  return clean(process.env.LEGAL_CONTACT_EMAIL);
}

export function legalOperator(): LegalOperator | null {
  const name = clean(process.env.LEGAL_ENTITY_NAME);
  if (!name) return null;
  return {
    name,
    id: clean(process.env.LEGAL_ENTITY_ID),
    address: clean(process.env.LEGAL_ADDRESS),
    email: clean(process.env.LEGAL_CONTACT_EMAIL),
  };
}
