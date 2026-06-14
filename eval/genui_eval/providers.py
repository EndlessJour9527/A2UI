# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Extensible LLM provider implementations for GenUI Eval Studio."""

from __future__ import annotations

import json
import logging
import os
import urllib.request
from abc import ABC, abstractmethod
from openai import OpenAI

logger = logging.getLogger(__name__)

SAMPLE_COMPLETION = """<a2ui-json>
[
  {
    "version": "v0.9",
    "createSurface": {
      "surfaceId": "main",
      "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
    }
  },
  {
    "version": "v0.9",
    "updateComponents": {
      "surfaceId": "main",
      "components": [
        {
          "id": "root",
          "component": "Text",
          "text": "Hello from Eval Studio MVP",
          "variant": "body"
        }
      ]
    }
  }
]
</a2ui-json>"""


class BaseProvider(ABC):
    """Abstract base class for all run model completion providers."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique key name of the provider (e.g. 'nvidia', 'local-openai')."""
        pass

    @abstractmethod
    def call_api(self, model_name: str, prompt: str, system_prompt: str | None = None) -> str:
        """Call the underlying API for a given model and prompt, returning final response."""
        pass

    @property
    @abstractmethod
    def default_models(self) -> list[str]:
        """Return the list of default supported models for this provider."""
        pass


class MockProvider(BaseProvider):
    """Mock provider for testing UI flows without external API calls."""

    @property
    def name(self) -> str:
        return "mock"

    @property
    def default_models(self) -> list[str]:
        return ["mock"]

    def call_api(self, model_name: str, prompt: str, system_prompt: str | None = None) -> str:
        # Mock logic is handled inside build_completion_provider callback
        raise NotImplementedError("Mock logic is handled in provider callback")


class StaticProvider(BaseProvider):
    """Static fallback provider that uses pre-defined targets."""

    @property
    def name(self) -> str:
        return "static"

    @property
    def default_models(self) -> list[str]:
        return ["static"]

    def call_api(self, model_name: str, prompt: str, system_prompt: str | None = None) -> str:
        raise NotImplementedError("Static logic is handled in provider callback")


class GeminiProvider(BaseProvider):
    """Direct Google Gemini API provider using native HTTP requests."""

    @property
    def name(self) -> str:
        return "llm"

    @property
    def default_models(self) -> list[str]:
        return [
            "google/gemini-2.5-flash",
            "google/gemini-3.5-flash",
            "google/gemini-3-flash-preview",
            "google/gemini-2.5-pro",
            "google/gemini-1.5-flash",
            "google/gemini-1.5-pro",
        ]

    def call_api(self, model_name: str, prompt: str, system_prompt: str | None = None) -> str:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY environment variable is not set")

        if model_name.startswith("google/"):
            model_name = model_name[7:]

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        headers = {"Content-Type": "application/json"}
        
        data = {
            "contents": [
                {
                    "parts": [
                        {"text": prompt}
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.1
            }
        }

        if system_prompt:
            data["systemInstruction"] = {
                "parts": [
                    {"text": system_prompt}
                ]
            }

        req = urllib.request.Request(
            url,
            data=json.dumps(data).encode("utf-8"),
            headers=headers,
            method="POST"
        )

        try:
            with urllib.request.urlopen(req) as response:
                res_data = json.loads(response.read().decode("utf-8"))
                return res_data["candidates"][0]["content"]["parts"][0]["text"]
        except Exception as e:
            logger.error(f"Failed to fetch completion from Gemini API: {e}")
            if hasattr(e, "read"):
                try:
                    error_body = e.read().decode("utf-8")
                    logger.error(f"Gemini API Error details: {error_body}")
                except Exception:
                    pass
            raise


class LocalOpenAIProvider(BaseProvider):
    """Local OpenAI-compatible API provider client (e.g. running on localhost)."""

    @property
    def name(self) -> str:
        return "local-openai"

    @property
    def default_models(self) -> list[str]:
        # Return base model, actual formatted name parsed from .env on client side
        return ["gemini-3.5-flash-extra-low"]

    def call_api(self, model_name: str, prompt: str, system_prompt: str | None = None) -> str:
        base_url = os.environ.get("GENUI_EVAL_LOCAL_OPENAI_BASE_URL", "http://127.0.0.1:8045/v1")
        api_key = os.environ.get("GENUI_EVAL_LOCAL_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise ValueError(
                "GENUI_EVAL_LOCAL_OPENAI_API_KEY or OPENAI_API_KEY must be set for local-openai provider"
            )

        # Strip any proxy prefix like proxy_8045_ before passing to completions API
        if model_name.startswith("proxy_"):
            parts = model_name.split("_", 2)
            if len(parts) >= 3:
                model_name = parts[2]

        client = OpenAI(base_url=base_url, api_key=api_key)

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        try:
            completion = client.chat.completions.create(
                model=model_name,
                messages=messages,
                temperature=0.1,
            )
            return completion.choices[0].message.content
        except Exception as e:
            logger.error(f"Local OpenAI API call failed: {e}")
            raise


class NvidiaProvider(BaseProvider):
    """Nvidia NIM integration supporting DeepSeek and streaming reasoning output."""

    @property
    def name(self) -> str:
        return "nvidia"

    @property
    def default_models(self) -> list[str]:
        return [
            "deepseek-ai/deepseek-v4-flash",
            "nvidia/llama-3.1-nemotron-70b-instruct",
            "z-ai/glm-5.1",
        ]

    def call_api(self, model_name: str, prompt: str, system_prompt: str | None = None) -> str:
        api_key = os.environ.get("NVIDIA_API_KEY") or os.environ.get("GENUI_EVAL_NVIDIA_API_KEY")
        if not api_key:
            raise ValueError(
                "NVIDIA_API_KEY or GENUI_EVAL_NVIDIA_API_KEY environment variable is not set"
            )

        client = OpenAI(
            base_url="https://integrate.api.nvidia.com/v1",
            api_key=api_key
        )

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        try:
            completion = client.chat.completions.create(
                model=model_name,
                messages=messages,
                temperature=1.0,
                top_p=0.95,
                max_tokens=16384,
                extra_body={"chat_template_kwargs": {"thinking": True, "reasoning_effort": "high"}},
                stream=True
            )

            accumulated_content = []
            for chunk in completion:
                if not getattr(chunk, "choices", None):
                    continue
                # Extract and print reasoning chunk
                reasoning = (
                    getattr(chunk.choices[0].delta, "reasoning", None)
                    or getattr(chunk.choices[0].delta, "reasoning_content", None)
                )
                if reasoning:
                    print(reasoning, end="", flush=True)
                
                # Extract and accumulate code content chunk
                if chunk.choices and chunk.choices[0].delta.content is not None:
                    content_piece = chunk.choices[0].delta.content
                    print(content_piece, end="", flush=True)
                    accumulated_content.append(content_piece)

            return "".join(accumulated_content)
        except Exception as e:
            logger.error(f"Nvidia API call failed: {e}")
            raise


class ProviderRegistry:
    """Registry to manage and look up available providers."""

    def __init__(self):
        self._providers: dict[str, BaseProvider] = {}
        # Auto-register core providers
        self.register(MockProvider())
        self.register(StaticProvider())
        self.register(GeminiProvider())
        self.register(LocalOpenAIProvider())
        self.register(NvidiaProvider())

    def register(self, provider: BaseProvider):
        self._providers[provider.name] = provider

    def get(self, name: str) -> BaseProvider:
        if name not in self._providers:
            raise ValueError(f"Unknown provider: {name}")
        return self._providers[name]

    def list_providers(self) -> list[BaseProvider]:
        return list(self._providers.values())


# Singleton registry instance
registry = ProviderRegistry()
