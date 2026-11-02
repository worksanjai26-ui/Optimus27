package com.calculator.core;

import com.calculator.exception.UnknownOperationException;
import com.calculator.operation.Operation;

import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Holds the set of operations the calculator knows about, keyed by symbol.
 *
 * <p>The registry is the seam that makes the application modular: operations
 * are plugged in here at assembly time, and both the engine and the UI
 * discover them through this registry rather than hard-coding any operation.
 * Insertion order is preserved so menus list operations predictably.
 */
public class OperationRegistry {

    private final Map<String, Operation> operations = new LinkedHashMap<>();

    /**
     * Registers an operation under its own symbol.
     *
     * @param operation the operation to register
     * @return this registry, to allow fluent chaining
     */
    public OperationRegistry register(Operation operation) {
        operations.put(operation.symbol(), operation);
        return this;
    }

    /**
     * Looks up an operation by symbol.
     *
     * @param symbol the operation symbol
     * @return the matching operation
     * @throws UnknownOperationException if no operation is registered
     */
    public Operation get(String symbol) {
        Operation operation = operations.get(symbol);
        if (operation == null) {
            throw new UnknownOperationException(symbol);
        }
        return operation;
    }

    /** @return {@code true} if an operation is registered for the symbol. */
    public boolean supports(String symbol) {
        return operations.containsKey(symbol);
    }

    /** @return an optional view of the operation for the symbol. */
    public Optional<Operation> find(String symbol) {
        return Optional.ofNullable(operations.get(symbol));
    }

    /** @return an unmodifiable view of all registered operations. */
    public Collection<Operation> all() {
        return Collections.unmodifiableCollection(operations.values());
    }
}
