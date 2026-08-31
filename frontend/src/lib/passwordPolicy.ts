export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_POLICY_MESSAGE = "비밀번호는 8~128자이며 영문 대문자, 영문 소문자, 숫자, 특수문자를 각각 1개 이상 포함해야 합니다.";

export type PasswordConditions = {
  length: boolean;
  uppercase: boolean;
  lowercase: boolean;
  number: boolean;
  special: boolean;
};

export const PASSWORD_CONDITION_LABELS: Record<keyof PasswordConditions, string> = {
  length: "8~128자",
  uppercase: "영문 대문자 포함",
  lowercase: "영문 소문자 포함",
  number: "숫자 포함",
  special: "특수문자 포함",
};

export function getPasswordLength(password: string) {
  return Array.from(password).length;
}

function isAsciiPunctuation(codePoint: number) {
  return (codePoint >= 33 && codePoint <= 47)
    || (codePoint >= 58 && codePoint <= 64)
    || (codePoint >= 91 && codePoint <= 96)
    || (codePoint >= 123 && codePoint <= 126);
}

export function getPasswordConditions(password: string): PasswordConditions {
  const characters = Array.from(password);
  const length = characters.length;
  return {
    length: length >= PASSWORD_MIN_LENGTH && length <= PASSWORD_MAX_LENGTH,
    uppercase: characters.some((character) => character >= "A" && character <= "Z"),
    lowercase: characters.some((character) => character >= "a" && character <= "z"),
    number: characters.some((character) => character >= "0" && character <= "9"),
    special: characters.some((character) => isAsciiPunctuation(character.codePointAt(0) ?? 0)),
  };
}

export function isValidNewPassword(password: string) {
  return Object.values(getPasswordConditions(password)).every(Boolean);
}
