from pydantic import BaseModel, Field


class SearchResult(BaseModel):
    source: str
    kind: str
    score: float = Field(ge=0)
    title: str
    subtitle: str | None = None
    snippet: str | None = None
    link: str | None = None
    provenance: str | None = None


class SearchResponse(BaseModel):
    query: str
    count: int
    elapsed_ms: int
    warnings: list[str] = Field(default_factory=list)
    results: list[SearchResult] = Field(default_factory=list)


class ChatTurn(BaseModel):
    role: str = Field(pattern='^(system|user|assistant)$')
    content: str = Field(min_length=1, max_length=8000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    session_id: str | None = None
    limit: int = Field(default=12, ge=1, le=50)
    history: list[ChatTurn] = Field(default_factory=list)


class ChatResponse(BaseModel):
    reply: str
    session_id: str | None = None
    model: str | None = None
    warnings: list[str] = Field(default_factory=list)
    citations: list[SearchResult] = Field(default_factory=list)
