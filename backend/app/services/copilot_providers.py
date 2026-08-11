from __future__ import annotations

import json
import hashlib
import logging
from uuid import uuid4
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Protocol

import httpx
from fastapi.encoders import jsonable_encoder
from google import genai
from google.genai import types

from app.core.config import Settings

logger = logging.getLogger(__name__)
COPILOT_MAX_TOOL_ROUNDS = 6


@dataclass
class ProviderResult:
    text: str
    model: str
    provider: str


class ProviderNotConfiguredError(RuntimeError):
    pass


class ChatStatus(StrEnum):
    RATE_LIMITED = "RATE_LIMITED"
    REQUEST_FAILED = "REQUEST_FAILED"
    TOOL_FAILED = "TOOL_FAILED"
    INVALID_RESPONSE = "INVALID_RESPONSE"


class ProviderResponseError(RuntimeError):
    def __init__(self, message: str, *, status: ChatStatus = ChatStatus.REQUEST_FAILED, upstream_status: int | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.upstream_status = upstream_status


class ChatModelProvider(Protocol):
    async def generate(
        self,
        *,
        messages: list[dict[str, str]],
        instructions: str,
        tools: list[dict[str, Any]],
        execute: Any,
    ) -> ProviderResult: ...


class DisabledProvider:
    async def generate(self, **_: Any) -> ProviderResult:
        raise ProviderNotConfiguredError("AI provider is disabled")


class GeminiProvider:
    def __init__(self, settings: Settings) -> None:
        if not settings.GEMINI_API_KEY:
            raise ProviderNotConfiguredError("Gemini API key is not configured")
        self.model = settings.GEMINI_MODEL
        self.client = genai.Client(api_key=settings.GEMINI_API_KEY)
        self.diagnostic_logging = settings.APP_ENV.lower() not in {"production", "prod"}

    async def generate(self, *, messages: list[dict[str, str]], instructions: str, tools: list[dict[str, Any]], execute: Any) -> ProviderResult:
        request_id = uuid4().hex[:12]
        gemini_calls = 0
        tool_rounds = 0
        tools_executed = 0
        duplicate_tools_blocked = 0
        result_category = "in_progress"

        async def call_gemini(*, stage: str, contents: list[types.Content], config: types.GenerateContentConfig, tool_round: int) -> Any:
            nonlocal gemini_calls, result_category
            gemini_calls += 1
            call_number = gemini_calls
            if self.diagnostic_logging:
                logger.info(
                    "copilot_gemini_call request_id=%s stage=%s call_number=%s model=%s tool_round=%s",
                    request_id, stage, call_number, self.model, tool_round,
                )
            try:
                response = await self.client.aio.models.generate_content(model=self.model, contents=contents, config=config)
            except Exception as exc:
                status_code = getattr(exc, "status_code", None) or getattr(exc, "code", None)
                category = "rate_limited" if status_code == 429 or "RESOURCE_EXHAUSTED" in str(exc) else "provider_error"
                result_category = category
                if self.diagnostic_logging:
                    logger.info(
                        "copilot_gemini_result request_id=%s stage=%s call_number=%s model=%s tool_round=%s result=%s",
                        request_id, stage, call_number, self.model, tool_round, category,
                    )
                raise
            if self.diagnostic_logging:
                logger.info(
                    "copilot_gemini_result request_id=%s stage=%s call_number=%s model=%s tool_round=%s result=success",
                    request_id, stage, call_number, self.model, tool_round,
                )
            return response

        contents = [types.Content(role="model" if item["role"] == "assistant" else "user", parts=[types.Part.from_text(text=item["content"])]) for item in messages]
        declarations = [types.FunctionDeclaration(name=item["name"], description=item["description"], parameters_json_schema=item["parameters"]) for item in tools]
        config = types.GenerateContentConfig(
            system_instruction=instructions,
            tools=[types.Tool(function_declarations=declarations)] if declarations else None,
            tool_config=types.ToolConfig(function_calling_config=types.FunctionCallingConfig(mode="AUTO")) if declarations else None,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            response_mime_type="application/json",
        )
        final_config = types.GenerateContentConfig(
            system_instruction=instructions,
            response_mime_type="application/json",
        )
        executed: dict[str, Any] = {}
        stage = "initial_generate"
        try:
            response = await call_gemini(stage=stage, contents=contents, config=config, tool_round=0)
            for round_number in range(1, COPILOT_MAX_TOOL_ROUNDS + 1):
                calls = response.function_calls or []
                if not calls:
                    result_category = "success"
                    return ProviderResult(text=response.text or "", model=self.model, provider="gemini")
                tool_rounds = round_number
                if response.candidates and response.candidates[0].content:
                    contents.append(response.candidates[0].content)
                parts = []
                duplicate_detected = False
                for call in calls[:4]:
                    arguments = dict(call.args or {})
                    canonical_arguments = json.dumps(arguments, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
                    fingerprint = f"{call.name or ''}:{canonical_arguments}"
                    args_hash = hashlib.sha256(canonical_arguments.encode("utf-8")).hexdigest()[:12]
                    stage = "tool_execute"
                    is_duplicate = fingerprint in executed
                    if is_duplicate:
                        duplicate_detected = True
                        duplicate_tools_blocked += 1
                        result = executed[fingerprint]
                    else:
                        try:
                            result = jsonable_encoder(execute(call.name or "", arguments))
                        except Exception as exc:
                            logger.exception("Copilot tool execution failed tool=%s exception=%s", call.name or "unknown", type(exc).__name__)
                            raise ProviderResponseError("Tool execution failed", status=ChatStatus.TOOL_FAILED) from exc
                        executed[fingerprint] = result
                        tools_executed += 1
                    if self.diagnostic_logging:
                        result_count = len(result) if isinstance(result, (list, dict)) else None
                        logger.info(
                            "copilot_tool_call request_id=%s tool_round=%s tool=%s args_hash=%s duplicate=%s result_type=%s result_count=%s",
                            request_id, round_number, call.name or "unknown", args_hash, is_duplicate,
                            type(result).__name__, result_count,
                        )
                    response_payload = {"result": result}
                    if isinstance(result, list):
                        response_payload["count"] = len(result)
                    parts.append(types.Part.from_function_response(name=call.name or "", response=response_payload))
                # google-genai 2.x represents function responses as USER content;
                # the part itself carries the function_response discriminator.
                contents.append(types.Content(role="user", parts=parts))
                stage = "tool_follow_up"
                response = await call_gemini(
                    stage=stage, contents=contents,
                    config=final_config if duplicate_detected else config, tool_round=round_number,
                )
                if duplicate_detected:
                    result_category = "success"
                    return ProviderResult(text=response.text or "", model=self.model, provider="gemini")
            if not (response.function_calls or []):
                result_category = "success"
                return ProviderResult(text=response.text or "", model=self.model, provider="gemini")
            stage = "tool_follow_up"
            response = await call_gemini(stage=stage, contents=contents, config=final_config, tool_round=tool_rounds)
            if response.function_calls:
                raise ProviderResponseError("Gemini tool-call limit exceeded", status=ChatStatus.TOOL_FAILED)
            result_category = "success"
            return ProviderResult(text=response.text or "", model=self.model, provider="gemini")
        except ProviderResponseError as exc:
            result_category = exc.status.value.lower()
            raise
        except Exception as exc:
            status_code = getattr(exc, "status_code", None) or getattr(exc, "code", None)
            safe_message = " ".join(str(exc).split())[:500]
            logger.exception(
                "Gemini request failed stage=%s exception=%s status=%s message=%s",
                stage,
                type(exc).__name__,
                status_code,
                safe_message,
            )
            if status_code == 429 or "RESOURCE_EXHAUSTED" in str(exc):
                raise ProviderResponseError(
                    "Gemini rate limit exceeded",
                    status=ChatStatus.RATE_LIMITED,
                    upstream_status=429,
                ) from exc
            if status_code in {401, 403}:
                result_category = "not_configured"
                raise ProviderNotConfiguredError("Gemini authentication failed") from exc
            raise ProviderResponseError("Gemini request failed", upstream_status=status_code) from exc
        finally:
            if self.diagnostic_logging:
                logger.info(
                    "copilot_request_complete request_id=%s gemini_calls=%s tool_rounds=%s tools_executed=%s duplicate_tools_blocked=%s result=%s",
                    request_id, gemini_calls, tool_rounds, tools_executed, duplicate_tools_blocked, result_category,
                )


class OpenAIProvider:
    def __init__(self, settings: Settings) -> None:
        if not settings.OPENAI_API_KEY:
            raise ProviderNotConfiguredError("OpenAI API key is not configured")
        self.api_key = settings.OPENAI_API_KEY
        self.model = settings.OPENAI_MODEL
        self.base_url = settings.OPENAI_BASE_URL
        self.timeout = settings.COPILOT_TIMEOUT_SECONDS

    @staticmethod
    def _text(response: dict[str, Any]) -> str:
        if isinstance(response.get("output_text"), str):
            return response["output_text"]
        chunks = []
        for item in response.get("output", []):
            if item.get("type") == "message":
                chunks.extend(part.get("text", "") for part in item.get("content", []) if part.get("type") == "output_text")
        return "".join(chunks)

    async def generate(self, *, messages: list[dict[str, str]], instructions: str, tools: list[dict[str, Any]], execute: Any) -> ProviderResult:
        payload: dict[str, Any] = {"model": self.model, "instructions": instructions, "input": messages, "tools": tools, "tool_choice": "auto", "text": {"format": {"type": "json_object"}}}
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(f"{self.base_url.rstrip('/')}/responses", headers=headers, json=payload)
                response.raise_for_status()
                result = response.json()
                calls = [item for item in result.get("output", []) if item.get("type") == "function_call"]
                if calls:
                    outputs = []
                    for call in calls[:4]:
                        try:
                            arguments = json.loads(call.get("arguments") or "{}")
                        except json.JSONDecodeError:
                            arguments = {}
                        outputs.append({"type": "function_call_output", "call_id": call["call_id"], "output": json.dumps(execute(call.get("name", ""), arguments), ensure_ascii=False, default=str)})
                    follow_up = {"model": self.model, "instructions": instructions, "previous_response_id": result["id"], "input": outputs, "tools": tools, "text": payload["text"]}
                    response = await client.post(f"{self.base_url.rstrip('/')}/responses", headers=headers, json=follow_up)
                    response.raise_for_status()
                    result = response.json()
        except httpx.HTTPError as exc:
            raise ProviderResponseError("OpenAI request failed") from exc
        return ProviderResult(text=self._text(result), model=self.model, provider="openai")


def create_chat_provider(settings: Settings) -> ChatModelProvider:
    provider = settings.CHAT_MODEL_PROVIDER.strip().lower()
    if provider == "gemini":
        return GeminiProvider(settings)
    if provider == "openai":
        return OpenAIProvider(settings)
    if provider == "disabled":
        return DisabledProvider()
    raise ProviderNotConfiguredError(f"Unsupported chat provider: {provider}")
