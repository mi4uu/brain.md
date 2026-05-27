---
title: Math
tags: [feature, demo]
---

# Math (KaTeX)

Inline math with `$x$`, block math with `$$ … $$`.

## Inline

The Euler identity $e^{i\pi} + 1 = 0$ packs five fundamental constants
into a single equation. The probability of $X = x$ given parameters
$\theta$ is written $P(X=x \mid \theta)$.

## KaTeX block

The transformer attention score:

$$
\text{Attention}(Q, K, V) = \text{softmax}\!\left(\frac{QK^\top}{\sqrt{d_k}}\right) V
$$

Cosine similarity used by the RAG engine:

$$
\cos(\mathbf{a}, \mathbf{b}) = \frac{\mathbf{a} \cdot \mathbf{b}}{\|\mathbf{a}\|\,\|\mathbf{b}\|}
$$

Bayes:

$$
P(\theta \mid D) = \frac{P(D \mid \theta)\,P(\theta)}{P(D)}
$$

## Aligned

$$
\begin{aligned}
\nabla \cdot \mathbf{E} &= \frac{\rho}{\varepsilon_0} \\
\nabla \cdot \mathbf{B} &= 0 \\
\nabla \times \mathbf{E} &= -\frac{\partial \mathbf{B}}{\partial t} \\
\nabla \times \mathbf{B} &= \mu_0\mathbf{J} + \mu_0\varepsilon_0\frac{\partial \mathbf{E}}{\partial t}
\end{aligned}
$$
