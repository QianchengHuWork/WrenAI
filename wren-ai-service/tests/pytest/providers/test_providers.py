from pytest_mock import MockerFixture

from src.core.engine import Engine
from src.core.pipeline import PipelineComponent
from src.core.provider import DocumentStoreProvider, EmbedderProvider, LLMProvider
from src.providers import Configuration, generate_components, llm_processor, transform


def test_transform():
    config = [
        {
            "type": "llm",
            "provider": "openai_llm",
            "models": [
                {"model": "gpt-4", "kwargs": {"temperature": 0, "max_tokens": 4096}}
            ],
        },
        {
            "type": "embedder",
            "provider": "openai_embedder",
            "models": [{"model": "text-embedding-ada-002", "dimension": 1536}],
        },
        {
            "type": "document_store",
            "provider": "qdrant",
            "kwargs": {"host": "localhost", "port": 6333},
        },
        {
            "type": "engine",
            "provider": "wren_ui",
            "kwargs": {"host": "localhost", "port": 8000},
        },
        {
            "type": "pipeline",
            "pipes": [
                {
                    "name": "indexing",
                    "llm": "openai_llm.gpt-4",
                    "embedder": "openai_embedder.text-embedding-ada-002",
                    "document_store": "qdrant",
                    "engine": "wren_ui",
                }
            ],
        },
    ]

    result = transform(config)

    assert isinstance(result, Configuration)
    assert "openai_llm.gpt-4" in result.providers["llm"]
    assert "openai_embedder.text-embedding-ada-002" in result.providers["embedder"]
    assert "qdrant" in result.providers["document_store"]
    assert "wren_ui" in result.providers["engine"]
    assert "indexing" in result.pipelines


def test_generate_components(mocker: MockerFixture):
    # Mock the provider_factory to return mock objects
    mocker.patch(
        "src.providers.provider_factory",
        side_effect=[
            mocker.Mock(spec=EmbedderProvider),
            mocker.Mock(spec=LLMProvider),
            mocker.Mock(spec=DocumentStoreProvider),
            mocker.Mock(spec=Engine),
        ],
    )

    config = [
        {
            "type": "llm",
            "provider": "openai_llm",
            "models": [{"model": "gpt-4", "kwargs": {}}],
        },
        {
            "type": "embedder",
            "provider": "openai_embedder",
            "models": [{"model": "text-embedding-ada-002", "dimension": 1536}],
        },
        {"type": "document_store", "provider": "qdrant", "kwargs": {}},
        {"type": "engine", "provider": "wren_ui", "kwargs": {}},
        {
            "type": "pipeline",
            "pipes": [
                {
                    "name": "indexing",
                    "llm": "openai_llm.gpt-4",
                    "embedder": "openai_embedder.text-embedding-ada-002",
                    "document_store": "qdrant",
                    "engine": "wren_ui",
                }
            ],
        },
    ]

    result = generate_components(config)

    assert "indexing" in result
    assert isinstance(result["indexing"], PipelineComponent)
    assert isinstance(result["indexing"].embedder_provider, EmbedderProvider)
    assert isinstance(result["indexing"].llm_provider, LLMProvider)
    assert isinstance(result["indexing"].document_store_provider, DocumentStoreProvider)
    assert isinstance(result["indexing"].engine, Engine)


def test_llm_processor_includes_api_key_in_fallback_router_params(
    mocker: MockerFixture,
):
    mocker.patch.dict("os.environ", {"SILICONFLOW_API_KEY": "test-key"})

    result = llm_processor(
        {
            "type": "llm",
            "provider": "litellm_llm",
            "models": [
                {
                    "alias": "default",
                    "model": "openai/Pro/moonshotai/Kimi-K2.5",
                    "api_base": "https://api.siliconflow.cn/v1",
                    "api_key_name": "SILICONFLOW_API_KEY",
                    "kwargs": {"temperature": 0, "n": 1},
                    "fallbacks": ["openai/deepseek-ai/DeepSeek-V3"],
                },
                {
                    "alias": "fallback",
                    "model": "openai/deepseek-ai/DeepSeek-V3",
                    "api_base": "https://api.siliconflow.cn/v1",
                    "api_key_name": "SILICONFLOW_API_KEY",
                    "kwargs": {"temperature": 0, "n": 1},
                },
            ],
        }
    )

    fallback_model_list = result["litellm_llm.default"]["fallback_model_list"]

    assert [item["model_name"] for item in fallback_model_list] == [
        "openai/Pro/moonshotai/Kimi-K2.5",
        "openai/deepseek-ai/DeepSeek-V3",
    ]
    assert fallback_model_list[0]["litellm_params"]["api_key"] == "test-key"
    assert fallback_model_list[1]["litellm_params"]["api_key"] == "test-key"
