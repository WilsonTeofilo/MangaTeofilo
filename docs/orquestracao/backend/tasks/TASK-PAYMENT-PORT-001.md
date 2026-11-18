# TASK-PAYMENT-PORT-001 — Extração da Porta de Gateway de Pagamentos (`PaymentGatewayPort` - ADR-003)

**Status:** Especificada pelo Tech Lead Hermes  
**Executor:** OpenCode Backend Worker  
**Escopo:** Backend Spring Boot (`com.manganetworking.service.monetization` e `com.manganetworking.controller`)  

---

## 1. Contexto e Objetivo

Conforme documentado na **ADR-003** (Isolamento do Adaptador de Pagamentos e Idempotência Contábil):
> *"O domínio da aplicação deve depender exclusivamente de contratos agnósticos de gateway (`createPaymentIntent`, `verifyWebhookNotification`). A implementação atual usa `MercadoPagoService` diretamente; a extração do `PaymentGatewayPort` permanece dívida arquitetural."*

A classe `MonetizationController.java` injeta diretamente a classe concreta `MercadoPagoService`, acoplando o controlador financeiro central ao SDK/provedor específico do Mercado Pago em violação ao Princípio da Inversão de Dependência (DIP / Clean Architecture).

O objetivo desta tarefa é:
1. Extrair a interface de contrato agnóstico `PaymentGatewayPort`.
2. Fazer `MercadoPagoService` implementar formalmente `PaymentGatewayPort`.
3. Refatorar `MonetizationController` para injetar e depender de `PaymentGatewayPort`.
4. Atualizar os slices de teste (`MonetizationAuthorizationTest`) para mockar a interface `PaymentGatewayPort`.

---

## 2. Instruções Técnicas Passo a Passo

### Passo 1: Criar `PaymentGatewayPort.java`
Criar a interface em `D:\Projetos\MangaNetWorking\backend\src\main\java\com\manganetworking\service\monetization\PaymentGatewayPort.java`:

```java
package com.manganetworking.service.monetization;

import com.manganetworking.service.monetization.dto.CheckoutResponseDto;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Porta de saída (Output Port / Clean Architecture) para provedores de pagamento.
 *
 * <p>Isola o domínio de monetização e os controladores REST de implementações específicas
 * de gateways (ex.: Mercado Pago, Stripe ou Sandbox local), conforme preconizado na ADR-003.</p>
 */
public interface PaymentGatewayPort {

    BigDecimal getVipPrice();

    CheckoutResponseDto createDonationCheckoutPreference(
            UUID payerUserId,
            UUID creatorId,
            UUID workId,
            UUID chapterId,
            BigDecimal amountBrl,
            String message,
            String idempotencyKey
    );

    CheckoutResponseDto createMembershipCheckoutPreference(
            UUID payerUserId,
            UUID creatorId,
            String idempotencyKey
    );

    String createVipCheckoutPreference(UUID userId);

    boolean verifyWebhookSignature(String signatureHeader, String requestIdHeader, String dataId);

    void processPaymentNotification(String paymentId);
}
```

### Passo 2: Atualizar `MercadoPagoService.java`
Fazer a classe implementar a interface:
```java
@Service
public class MercadoPagoService implements PaymentGatewayPort {
    ...
```
Adicionar `@Override` nos métodos correspondentes (`getVipPrice`, `createDonationCheckoutPreference`, `createMembershipCheckoutPreference`, `createVipCheckoutPreference`, `verifyWebhookSignature`, `processPaymentNotification`).

### Passo 3: Refatorar `MonetizationController.java`
- Substituir o campo `private final MercadoPagoService mercadoPagoService;` por `private final PaymentGatewayPort paymentGatewayPort;`.
- Atualizar o construtor:
  ```java
  public MonetizationController(MonetizationService monetizationService, PaymentGatewayPort paymentGatewayPort) {
      this.monetizationService = monetizationService;
      this.paymentGatewayPort = paymentGatewayPort;
  }
  ```
- No método `createDonationCheckout`, delegar para `paymentGatewayPort.createDonationCheckoutPreference(...)`.
- No método `createMembershipCheckout`, delegar para `paymentGatewayPort.createMembershipCheckoutPreference(...)`.

### Passo 4: Atualizar `MonetizationAuthorizationTest.java`
- Atualizar a declaração do mock:
  ```java
  @MockitoBean
  private PaymentGatewayPort paymentGatewayPort;
  ```
- Importar `com.manganetworking.service.monetization.PaymentGatewayPort;`.

---

## 3. Critérios de Aceite

- [ ] Interface `PaymentGatewayPort` criada em `com.manganetworking.service.monetization`.
- [ ] `MercadoPagoService` implementa `PaymentGatewayPort`.
- [ ] `MonetizationController` depende de `PaymentGatewayPort` sem referência direta a `MercadoPagoService`.
- [ ] Compilação limpa sem erros ou warnings.
- [ ] Suíte completa do backend verde:
  `Set-Location D:\Projetos\MangaNetWorking\backend; mvn -o test` (mínimo 453 testes passando, 0 falhas).
- [ ] Relatório gerado em:
  `D:\Projetos\MangaNetWorking\docs\orquestracao\backend\relatorios\RELATORIO-PAYMENT-PORT-001.md`
  e replicado em `D:\Projetos\MangaTeofilo\docs\orquestracao\backend\relatorios\RELATORIO-PAYMENT-PORT-001.md`.

---

Assinado por: Hermes (Tech Lead / Gerente / Arquiteto)
