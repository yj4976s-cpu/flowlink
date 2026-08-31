import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getPasswordConditions, getPasswordLength, isValidNewPassword, PASSWORD_CONDITION_LABELS } from "../src/lib/passwordPolicy.ts";

const authSource = readFileSync(new URL("../src/components/auth/AuthShell.tsx", import.meta.url), "utf8");
const headerSource = readFileSync(new URL("../src/components/layout/Header.tsx", import.meta.url), "utf8");
const myPageSource = readFileSync(new URL("../src/components/mypage/MyPageClient.tsx", import.meta.url), "utf8");

test("new passwords require all five canonical ASCII conditions", () => {
  assert.deepEqual(Object.keys(PASSWORD_CONDITION_LABELS), ["length", "uppercase", "lowercase", "number", "special"]);
  for (const password of ["flowlink123", "Flowlink123", "flowlink123!", "FLOWLINK123!", "Flowlink!", "Ab1!"]) assert.equal(isValidNewPassword(password), false, password);
  assert.deepEqual(getPasswordConditions("Flowlink123!"), { length: true, uppercase: true, lowercase: true, number: true, special: true });
  assert.equal(isValidNewPassword("Flowlink123!"), true);
});

test("Unicode code point length matches backend semantics while extra Unicode remains allowed", () => {
  assert.equal(getPasswordLength("😀Aa1!xxx"), 8);
  assert.equal(isValidNewPassword("😀Aa1!xxx"), true);
  assert.equal(isValidNewPassword("가Flowlink123!"), true);
});

test("registration renders a five-condition guide and live confirmation feedback", () => {
  assert.match(authSource, /<PasswordConditions password=\{password\}/);
  assert.match(authSource, /PASSWORD_CONDITION_LABELS/);
  assert.match(authSource, /비밀번호와 일치해요/);
  assert.match(authSource, /비밀번호가 일치하지 않아요/);
  assert.match(authSource, /passwordConfirm \?\) setErrors|if \(passwordConfirm\)/);
  assert.match(authSource, /isValidNewPassword\(password\)/);
  assert.doesNotMatch(authSource, /영문·숫자 조합 8자 이상/);
});

test("registration exposes exactly one live confirmation message", () => {
  assert.equal((authSource.match(/비밀번호와 일치해요/g) ?? []).length, 1);
  assert.equal((authSource.match(/비밀번호가 일치하지 않아요/g) ?? []).length, 1);
  assert.match(authSource, /renderErrorMessage=\{false\}>\{passwordConfirmMessage && <p[^>]+id="password-confirm-status"[^>]+aria-live="polite"/);
  assert.match(authSource, /aria-describedby=\{\[describedBy, error && renderErrorMessage \? errorId : undefined\]/);
});

test("confirmation status reacts to either password and submit keeps one mismatch message", () => {
  assert.match(authSource, /if \(passwordConfirm\) setErrors\(\(current\) => passwordConfirm === nextPassword/);
  assert.match(authSource, /setPasswordConfirm\(nextConfirm\);[\s\S]*nextConfirm === password/);
  assert.match(authSource, /else if \(password !== confirm\) nextErrors\["password-confirm"\] = passwordMismatchMessage/);
  assert.match(authSource, /passwordConfirm === password \? passwordMatchMessage : passwordMismatchMessage/);
  assert.match(authSource, /\{passwordConfirmMessage\}<\/p>/);
  assert.doesNotMatch(authSource, /! 비밀번호가 일치하지 않아요/);
});

test("empty confirmation is silent until submit then exposes one described required error", () => {
  assert.equal((authSource.match(/비밀번호를 한 번 더 입력해주세요\./g) ?? []).length, 1);
  assert.match(authSource, /const passwordConfirmMessage = passwordConfirm[\s\S]*: errors\["password-confirm"\]/);
  assert.match(authSource, /if \(!confirm\) nextErrors\["password-confirm"\] = "비밀번호를 한 번 더 입력해주세요\."/);
  assert.match(authSource, /describedBy=\{passwordConfirmMessage \? "password-confirm-status" : undefined\}/);
  assert.match(authSource, /error=\{errors\["password-confirm"\]\}/);
});

test("login CTA is prominent for users but absent from admin and social registration paths", () => {
  assert.match(authSource, /isAdminPortal \?[^:]+:[\s\S]*isLogin \? <div className="auth-signup-cta"/);
  assert.match(authSource, /새 계정 만들기/);
  assert.match(authSource, /!isSocialRegistration && <PasswordField/);
  assert.match(authSource, /!isLogin && !isSocialRegistration && <PasswordField id="password-confirm"/);
});

test("guest desktop and mobile headers expose register only in the guest branch", () => {
  assert.match(headerSource, /currentUser \? \([\s\S]*: \(\s*<>[\s\S]*href="\/login"[\s\S]*href="\/register"/);
  assert.equal((headerSource.match(/href="\/register"/g) ?? []).length, 2);
  assert.match(headerSource, /href="\/register" onClick=\{closeMenu\}/);
});

test("MyPage shares the new-password policy without applying it to current password", () => {
  assert.match(myPageSource, /from "@\/lib\/passwordPolicy"/);
  assert.match(myPageSource, /if \(!current\)/);
  assert.match(myPageSource, /isValidNewPassword\(nextPassword\)/);
  assert.match(myPageSource, /changePassword\(current, nextPassword\)/);
  assert.match(myPageSource, /비밀번호와 일치해요/);
  assert.match(myPageSource, /비밀번호가 일치하지 않아요/);
});
